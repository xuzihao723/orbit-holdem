import { afterEach, expect, it } from 'vitest';
import { gameContext } from '../helpers/game-context.js';
const contexts: Awaited<ReturnType<typeof gameContext>>[] = [];
async function context() {
  const c = await gameContext();
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it('does not apply or acknowledge an action when the SQLite writer is locked', async () => {
  const c = await context(),
    before = c.hand(),
    actor = c.actor(),
    cmd = c.actionCommand({ type: 'call' }),
    rows = c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n;
  c.storage.raw.exec('BEGIN IMMEDIATE');
  try {
    expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
      ok: false,
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  } finally {
    c.storage.raw.exec('ROLLBACK');
  }
  expect(c.hand()).toBe(before);
  expect(c.readRoom(c.roomId).row.status).toBe('pausedFault');
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(rows);
  expect(
    c.storage.db.repositories.findReceipt('session:' + actor.sessionId, cmd.commandId),
  ).toBeNull();
  expect(await c.play({ type: 'call' })).toMatchObject({ code: 'ROOM_PAUSED' });
});
it('rolls back events and terminal result when a database constraint rejects the receipt', async () => {
  const c = await context(),
    before = c.hand(),
    actor = c.actor(),
    cmd = c.actionCommand({ type: 'fold' }),
    rows = c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n;
  c.storage.raw.exec(
    "CREATE TRIGGER reject_game_receipt BEFORE INSERT ON command_receipts WHEN NEW.event='game:action' BEGIN SELECT RAISE(ABORT,'fixture IO failure'); END",
  );
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
    code: 'PERSISTENCE_UNAVAILABLE',
  });
  expect(c.hand()).toBe(before);
  expect(c.app.database.hands.readHand(before.handId)!.status).toBe('active');
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(rows);
  c.storage.raw.exec('DROP TRIGGER reject_game_receipt');
  expect(c.storage.raw.isTransaction).toBe(false);
  expect(
    c.storage.db.repositories.findReceipt('session:' + actor.sessionId, cmd.commandId),
  ).toBeNull();
});
it('pauses a corrupt core candidate without publishing private state or changing database chips', async () => {
  const c = await context(),
    before = c.hand(),
    room = c.readRoom(c.roomId);
  c.app.rooms.store.replace({
    ...room,
    hand: {
      ...before,
      players: before.players.map((p, i) => (i === 0 ? { ...p, stack: p.stack + 1 } : p)),
    },
  });
  expect(await c.play({ type: 'call' })).toMatchObject({ ok: false, code: 'ROOM_PAUSED' });
  expect(c.readRoom(c.roomId).row.status).toBe('pausedFault');
  expect(c.app.database.hands.readHand(before.handId)!.handVersion).toBe(before.handVersion);
  expect(c.storage.raw.prepare('SELECT SUM(stack) n FROM participants').get()?.n).toBe(3970);
});
it('rejects redistributed terminal result balances and rolls back the whole action', async () => {
  const c = await context(),
    before = c.hand(),
    commit = c.app.database.hands.commitHandAction;
  c.app.database.hands.commitHandAction = (batch) => {
    const b = structuredClone(batch);
    const stacks = b.hand.result!.finalStacks as { stack: number }[];
    stacks[0]!.stack++;
    stacks[1]!.stack--;
    commit(b);
  };
  expect(await c.play({ type: 'fold' })).toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  expect(c.hand()).toBe(before);
  expect(c.app.database.hands.readHand(before.handId)!.handVersion).toBe(before.handVersion);
  expect(c.storage.raw.isTransaction).toBe(false);
});
it('rolls back an event sequence collision without leaving an open transaction', async () => {
  const c = await context(),
    before = c.hand(),
    commit = c.app.database.hands.commitHandAction,
    count = c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n;
  c.app.database.hands.commitHandAction = (b) =>
    commit({ ...b, events: b.events.map((e, i) => (i === 0 ? { ...e, sequence: 1 } : e)) });
  expect(await c.play({ type: 'call' })).toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  expect(c.hand()).toBe(before);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(count);
  expect(c.storage.raw.isTransaction).toBe(false);
});
it('rolls back a real receipt uniqueness race and retains the winning receipt', async () => {
  const c = await context(),
    before = c.hand(),
    actor = c.actor(),
    cmd = c.actionCommand({ type: 'call' }),
    commit = c.app.database.hands.commitHandAction;
  c.app.database.hands.commitHandAction = (b) => {
    const result = {
      ...c.app.sessions.meta(),
      commandId: cmd.commandId,
      ok: false as const,
      code: 'NOT_READY' as const,
      duplicate: false,
      roomId: null,
      handId: null,
      retryable: false,
      fieldIssues: [],
      latestRoomVersion: null,
      latestHandVersion: null,
      retryAfterMs: null,
    };
    c.app.database.repositories.commitAppliedCommand({
      events: [],
      handVersionUpdate: null,
      receipt: {
        ...b.receipt,
        result,
        roomId: null,
        handId: null,
        appliedRoomVersion: null,
        appliedHandVersion: null,
      },
    });
    commit(b);
  };
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
    code: 'PERSISTENCE_UNAVAILABLE',
  });
  expect(c.hand()).toBe(before);
  expect(c.app.database.hands.readHand(before.handId)!.handVersion).toBe(before.handVersion);
  expect(c.storage.raw.isTransaction).toBe(false);
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
    code: 'NOT_READY',
    duplicate: true,
  });
});
