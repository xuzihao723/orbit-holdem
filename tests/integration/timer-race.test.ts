import { afterEach, expect, it } from 'vitest';
import { gameContext } from '../helpers/game-context.js';
import { timerContext } from '../helpers/timer-context.js';
import { timeoutScenario } from '../helpers/lifecycle-scenarios.js';
import { timeoutAction } from '../../apps/server/src/game/timeout-policy.js';
import { getLegalActions } from '../../packages/poker-core/src/index.js';
import { randomUUID } from 'node:crypto';
import { createApplicationRuntime } from '../../apps/server/src/application-runtime.js';
import { persistenceContext } from '../helpers/persistence-context.js';
import { TurnTimer } from '../../apps/server/src/game/turn-timer.js';
it('uses the injected clock as the single time domain and preserves instance method binding', async () => {
  const storage = persistenceContext();
  class BoundClock {
    value = 123;
    now() {
      return this.value;
    }
    setTimer() {
      return 0;
    }
    clearTimer() {}
  }
  const clock = new BoundClock(),
    app = createApplicationRuntime({ database: storage.db, serverClock: clock });
  try {
    expect(app.sessions.meta().serverTime).toBe(123);
    clock.value = 500;
    expect(app.sessions.meta().serverTime).toBe(500);
  } finally {
    await app.close();
    storage.close();
  }
});
it('contains a timer callback clock failure rather than throwing out of the event loop', async () => {
  const c = await timerContext();
  contexts.push(c);
  let callback!: () => void,
    fail = false,
    applied = 0;
  const faults: string[] = [],
    timer = new TurnTimer(
      {
        now() {
          if (fail) throw Error('clock failure');
          return 0;
        },
        setTimer(cb) {
          callback = cb;
          return 1;
        },
        clearTimer() {},
      },
      async () => {
        applied++;
      },
      (id) => faults.push(id),
    );
  timer.sync(c.readRoom(c.roomId));
  fail = true;
  expect(() => callback()).not.toThrow();
  expect(faults).toEqual([c.roomId]);
  expect(applied).toBe(0);
  timer.close();
});
it('deduplicates concurrent timeouts and detects a changed internal intent under the same ID', async () => {
  const c = await timerContext();
  contexts.push(c);
  const token = c.token();
  await c.clock.advanceTo(30000, false);
  const results = await Promise.all(
    Array.from({ length: 10 }, () => c.app.rooms.executeTimeout(token)),
  );
  expect(results.filter((v) => v === 'applied')).toHaveLength(1);
  expect(results.filter((v) => v === 'duplicate')).toHaveLength(9);
  expect(c.internalReceiptCount()).toBe(1);
  const hand = c.hand();
  expect(await c.app.rooms.executeTimeout({ ...token, actorParticipantId: 'changed' })).toBe(
    'paused',
  );
  expect(c.hand()).toBe(hand);
  expect(c.internalReceiptCount()).toBe(1);
});
it('rolls back timeout events and results when the native receipt insert fails', async () => {
  const c = await timerContext();
  contexts.push(c);
  const hand = c.hand(),
    count = c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n;
  c.storage.raw.exec(
    "CREATE TRIGGER fail_timeout BEFORE INSERT ON command_receipts WHEN NEW.event='internal:timeout' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END",
  );
  await c.clock.advanceTo(30000);
  expect(c.hand()).toBe(hand);
  expect(c.app.database.hands.readHand(hand.handId)!.status).toBe('active');
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(count);
  expect(c.internalReceiptCount()).toBe(0);
  expect(c.storage.raw.isTransaction).toBe(false);
  c.storage.raw.exec('DROP TRIGGER fail_timeout');
});
const contexts: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it('reads original LIFE05 amounts and uses only free check or fold in both variants', () => {
  const fixture = timeoutScenario();
  expect(fixture.deadline).toBe(30000);
  expect(fixture.expected).toMatchObject({
    automaticCallCount: 0,
    appliedActionsPerTurn: 1,
    oldTimerMayAdvanceNextTurn: false,
  });
  for (const v of fixture.variants) {
    const legal = getLegalActions(
      {
        street: 'flop',
        bigBlind: 20,
        currentBet: v.currentBet,
        lastFullRaiseSize: 100,
        players: [
          {
            seatId: 0,
            stack: v.actorStack,
            streetCommitted: v.actorCommitted,
            handCommitted: v.actorCommitted,
            folded: false,
            allIn: false,
            lastActedAtBet: null,
          },
          {
            seatId: 1,
            stack: 1000,
            streetCommitted: v.currentBet,
            handCommitted: v.currentBet,
            folded: false,
            allIn: false,
            lastActedAtBet: null,
          },
        ],
        actionOrder: [0, 1],
        pendingSeatIds: [0, 1],
        actorSeatId: 0,
      },
      0,
    );
    expect(timeoutAction(legal)?.type).toBe(
      (fixture.expected.timeoutActions as Record<string, string>)[v.name],
    );
  }
  expect(fixture.races.map((r) => r.receivedAt)).toEqual([29999, 30001]);
});
it('registers an earlier real action in room order while its identity is blocked', async () => {
  const c = await gameContext();
  contexts.push(c);
  const actor = c.actor(),
    before = c.hand();
  let release!: () => void;
  const gate = c.app.rooms.identities.run(
    actor.sessionId,
    () => new Promise<void>((r) => (release = r)),
  );
  await Promise.resolve();
  const action = c.app.rooms.execute({
    event: 'game:action',
    payload: c.actionCommand({ type: 'call' }),
    control: c.app.sessions.registry.getCurrent(actor.sessionId)!,
    receivedAt: c.clock.now,
  });
  const observed = c.app.rooms.queue.run(c.roomId, () => c.hand().handVersion);
  release();
  await gate;
  expect((await action).ok).toBe(true);
  expect(await observed).toBe(before.handVersion + 1);
});
it('folds instead of calling at the exact deadline and applies the timeout once', async () => {
  const c = await timerContext();
  contexts.push(c);
  const before = c.hand();
  expect(c.deadline()).toBe(30000);
  const token = c.token();
  await c.clock.advanceTo(30000);
  expect(c.events('actionApplied').at(-1)).toMatchObject({ actionType: 'fold', paidAmount: 0 });
  expect(c.hand().handVersion).toBe(before.handVersion + 1);
  expect(c.internalReceiptCount()).toBe(1);
  expect(await c.app.rooms.executeTimeout(token)).toBe('duplicate');
  expect(c.internalReceiptCount()).toBe(1);
  expect(c.clock.pending).toBe(0);
});
it('checks for free and preserves one clock through unrelated room changes and illegal actions', async () => {
  const c = await timerContext();
  contexts.push(c);
  expect((await c.play({ type: 'call' })).ok).toBe(true);
  const deadline = c.deadline();
  expect(deadline).toBe(30000);
  expect(await c.play({ type: 'raise', raiseTo: 1 })).toMatchObject({ ok: false });
  expect(c.deadline()).toBe(deadline);
  await c.clock.advanceTo(deadline!);
  expect(c.events('actionApplied').at(-1)).toMatchObject({ actionType: 'check', paidAmount: 0 });
  expect(c.internalReceiptCount()).toBe(1);
  expect(c.clock.pending).toBe(1);
});
it.each([30000, 30001])(
  'rejects a newly received action at %i even when its timer callback is delayed',
  async (at) => {
    const c = await timerContext();
    contexts.push(c);
    const before = c.hand();
    await c.clock.advanceTo(at, false);
    expect(await c.play({ type: 'call' })).toMatchObject({ code: 'TURN_EXPIRED' });
    expect(c.hand()).toBe(before);
    await c.clock.advanceTo(at);
    expect(c.internalReceiptCount()).toBe(1);
  },
);
it('accepts an action received before deadline while queued and discards its old timer', async () => {
  const c = await timerContext({ players: 3 });
  contexts.push(c);
  expect(c.deadline()).toBe(30000);
  const old = c.token(),
    actor = c.actor();
  let release!: () => void;
  const gate = c.app.rooms.identities.run(
    actor.sessionId,
    () => new Promise<void>((r) => (release = r)),
  );
  await Promise.resolve();
  await c.clock.advanceTo(29999, false);
  const pending = c.app.rooms.execute({
    event: 'game:action',
    payload: c.actionCommand({ type: 'call' }),
    control: c.app.sessions.registry.getCurrent(actor.sessionId)!,
    receivedAt: 29999,
  });
  await c.clock.advanceTo(30001, false);
  const timer = c.app.rooms.executeTimeout(old);
  release();
  await gate;
  expect(await pending).toMatchObject({ ok: true });
  expect(await timer).toBe('stale');
  expect(c.internalReceiptCount()).toBe(0);
  expect(c.deadline()).toBe(60001);
});
it('does not activate a candidate timer or candidate chips when persistence fails', async () => {
  const c = await timerContext();
  contexts.push(c);
  const before = c.hand();
  c.storage.raw.exec('BEGIN IMMEDIATE');
  try {
    await c.clock.advanceTo(30000);
  } finally {
    c.storage.raw.exec('ROLLBACK');
  }
  expect(c.hand()).toBe(before);
  expect(c.readRoom(c.roomId).row.status).toBe('pausedFault');
  expect(c.internalReceiptCount()).toBe(0);
  expect(c.clock.pending).toBe(0);
});
it('keeps deadline through a waiting join and a duplicate and cancels all scheduled work on close', async () => {
  const c = await timerContext();
  contexts.push(c);
  const old = c.deadline(),
    actor = c.actor(),
    cmd = c.actionCommand({ type: 'call' });
  const d = await c.guest('D');
  expect(
    await c.command(d.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'D',
    }),
  ).toMatchObject({ ok: true });
  expect(c.deadline()).toBe(old);
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({ ok: true });
  await c.clock.advanceTo(5000);
  const next = c.deadline();
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
    ok: true,
    duplicate: true,
  });
  expect(c.deadline()).toBe(next);
  await c.close();
  contexts.pop();
  expect(c.clock.pending).toBe(0);
  await c.clock.advanceTo(90000);
});
