import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { gameContext } from '../helpers/game-context.js';
import { invalidDefinition } from '../helpers/invalid-hand-cases.js';
import { assertHandInvariants } from '../../packages/poker-core/src/index.js';
const contexts: Awaited<ReturnType<typeof gameContext>>[] = [];
async function context(input: Parameters<typeof gameContext>[0] = {}) {
  const c = await gameContext(input);
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it.each([2, 3, 4] as const)(
  'finishes a real %i human hand with continuous stored events and a matching result',
  async (players) => {
    const c = await context({ players }),
      initial = c.hand();
    const count = await c.passive(),
      hand = c.hand();
    assertHandInvariants(hand);
    expect(hand.handVersion).toBe(count + 1);
    expect(hand.players.reduce((n, p) => n + p.stack, 0)).toBe(players * 2000);
    expect(hand.settlementCount).toBe(1);
    const row = c.app.database.hands.readHand(hand.handId)!;
    expect(row.status).toBe('settled');
    expect(row.result!.finalStacks.map((p) => p.stack)).toEqual(hand.players.map((p) => p.stack));
    const events = c.storage.raw
      .prepare('SELECT * FROM hand_events WHERE hand_id=? ORDER BY sequence')
      .all(initial.handId);
    expect(events.map((e) => e.sequence)).toEqual(
      Array.from({ length: hand.eventSequence }, (_, i) => i + 1),
    );
    expect(events.filter((e) => e.kind === 'handSettled')).toHaveLength(1);
    expect(
      events
        .filter((e) => e.kind === 'cardBurned')
        .every((e) => String(e.payload_json) === '{"count":1}'),
    ).toBe(true);
    expect(
      c
        .readRoom(c.roomId)
        .participants.filter((p) => p.sessionId !== null)
        .every((p) => !p.ready),
    ).toBe(true);
  },
);
it('rejects stale hand/turn/version, wrong actor and illegal amount without changing chips or events', async () => {
  const c = await context(),
    before = c.hand(),
    actor = c.actor(),
    base = c.actionCommand({ type: 'call' }),
    other = c.humans.find((h) => h.sessionId !== actor.sessionId)!;
  for (const [patch, code] of [
    [{ handId: 'old' }, 'HAND_MISMATCH'],
    [{ turnId: 'old' }, 'TURN_EXPIRED'],
    [{ expectedVersion: 0 }, 'STALE_STATE'],
    [{ action: { type: 'raise', raiseTo: 30 } }, 'ILLEGAL_AMOUNT'],
  ] as const) {
    const ack = await c.command(actor.socket, 'game:action', {
      ...base,
      ...patch,
      commandId: randomUUID(),
    });
    expect(ack).toMatchObject({ ok: false, code });
    expect(c.hand()).toBe(before);
  }
  expect(
    await c.command(other.socket, 'game:action', { ...base, commandId: randomUUID() }),
  ).toMatchObject({ code: 'NOT_YOUR_TURN' });
  expect(c.hand()).toBe(before);
  expect(
    c.storage.raw.prepare("SELECT COUNT(*) n FROM hand_events WHERE kind='actionApplied'").get()?.n,
  ).toBe(0);
});
it('allows a correct hand action after an unrelated waiting member increments only roomVersion', async () => {
  const c = await context(),
    old = c.actionCommand({ type: 'call' }),
    actor = c.actor(),
    before = c.hand(),
    r = c.readRoom(c.roomId),
    waiting = await c.guest('Waiting');
  expect(
    (
      await c.command(waiting.socket, 'room:join', {
        commandId: randomUUID(),
        roomCode: r.row.roomCode,
        nickname: 'Waiting',
      })
    ).ok,
  ).toBe(true);
  expect(c.hand()).toBe(before);
  expect(c.readRoom(c.roomId).row.roomVersion).toBe(r.row.roomVersion + 1);
  expect(
    await c.command(waiting.socket, 'game:action', { ...old, commandId: randomUUID() }),
  ).toMatchObject({ code: 'ILLEGAL_ACTION' });
  expect((await c.command(actor.socket, 'game:action', old)).ok).toBe(true);
  expect(c.hand().handVersion).toBe(before.handVersion + 1);
});
it('keeps check-only actions out of roomVersion and starts the next hand without another grant', async () => {
  const c = await context();
  expect((await c.play({ type: 'call' })).ok).toBe(true);
  const before = c.readRoom(c.roomId).row.roomVersion;
  expect((await c.play({ type: 'check' })).ok).toBe(true);
  expect(c.readRoom(c.roomId).row.roomVersion).toBe(before);
  await c.passive();
  const match = c.readRoom(c.roomId).match.matchId,
    dealer = c.hand().positions.dealerSeatId;
  for (const h of c.humans)
    expect(
      (
        await c.command(h.socket, 'room:ready', {
          commandId: randomUUID(),
          roomId: c.roomId,
          expectedRoomVersion: c.readRoom(c.roomId).row.roomVersion,
          ready: true,
        })
      ).ok,
    ).toBe(true);
  expect(
    (
      await c.command(c.humans[0]!.socket, 'room:start', {
        commandId: randomUUID(),
        roomId: c.roomId,
        expectedRoomVersion: c.readRoom(c.roomId).row.roomVersion,
      })
    ).ok,
  ).toBe(true);
  expect(c.readRoom(c.roomId).match.matchId).toBe(match);
  expect(c.hand().positions.dealerSeatId).not.toBe(dealer);
  expect(c.storage.db.repositories.listLedger(c.roomId)).toHaveLength(2);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hands').get()?.n).toBe(2);
});
it('uses the original reachable short-all-in prefix before refusing an unreopened raise or all-in', async () => {
  const definition = invalidDefinition('raiseWithoutReopening', 0),
    c = await context({
      players: 4,
      dealerSeatId: 3,
      stacks: definition.input.players.map((p) => p.stack),
      deck: definition.input.deck,
    });
  for (const action of definition.prefix) expect((await c.play(action)).ok).toBe(true);
  const before = c.hand();
  expect(before.betting!.actorSeatId).toBe(0);
  expect(await c.play({ type: 'raise', raiseTo: 250 })).toMatchObject({ code: 'ILLEGAL_ACTION' });
  expect(await c.play({ type: 'allIn' })).toMatchObject({ code: 'ILLEGAL_ACTION' });
  expect(c.hand()).toBe(before);
});
it('denies a foreign identity before disclosing versions or hand state', async () => {
  const c = await context(),
    foreign = await c.guest('Outsider'),
    cmd = c.actionCommand({ type: 'call' }),
    before = c.hand();
  expect(await c.command(foreign.socket, 'game:action', cmd)).toMatchObject({
    code: 'ROOM_FORBIDDEN',
    roomId: null,
    handId: null,
    latestRoomVersion: null,
    latestHandVersion: null,
  });
  expect(c.hand()).toBe(before);
});
