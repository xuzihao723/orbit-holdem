import { afterEach, expect, it } from 'vitest';
import { botContext } from '../helpers/bot-context.js';
import { botActionCommand } from '../../apps/server/src/game/internal-command.js';
const contexts: Awaited<ReturnType<typeof botContext>>[] = [];
it('does not allow a real human control to act for the bot through the public action event', async () => {
  const c = await context(),
    o = c.observation();
  expect(
    await c.command(c.humans[0]!.socket, 'game:action', {
      commandId: crypto.randomUUID(),
      roomId: c.roomId,
      handId: o.handId,
      turnId: o.turnId,
      expectedVersion: o.handVersion,
      action: { type: 'check' },
    }),
  ).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
  expect(await c.app.rooms.executeBotAction(botActionCommand(o, { type: 'check' }))).toBe(
    'applied',
  );
});
it('rejects changed intent under an already committed bot turn id without applying again', async () => {
  const c = await context(),
    o = c.observation();
  expect(await c.app.rooms.executeBotAction(botActionCommand(o, { type: 'check' }))).toBe(
    'applied',
  );
  const before = c.room().hand;
  expect(await c.app.rooms.executeBotAction(botActionCommand(o, { type: 'fold' }))).toBe('paused');
  expect(c.room().hand).toBe(before);
});
it('discards an old decision after actual settlement and removal of its bot', async () => {
  const c = await context(),
    o = c.observation(),
    old = botActionCommand(o, { type: 'check' });
  expect(await c.app.rooms.executeBotAction(botActionCommand(o, { type: 'fold' }))).toBe('applied');
  expect(c.room().hand!.phase).toBe('settled');
  expect(
    await c.command(c.humans[0]!.socket, 'room:bot:remove', {
      ...c.version(),
      seatId: c.bot.seatId,
    }),
  ).toMatchObject({ ok: true });
  const before = c.room().hand;
  expect(await c.app.rooms.executeBotAction({ ...old, turnId: 'old-unrecorded' })).toBe('stale');
  expect(c.room().hand).toBe(before);
});
async function context() {
  const c = await botContext();
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it('commits ten copies of one real bot turn once with a bot receipt and no private acknowledgement', async () => {
  const c = await context(),
    before = c.room().hand!,
    command = botActionCommand(c.observation(), { type: 'check' }),
    frames: unknown[] = [];
  c.humans[0]!.socket.on('command:ack', (v) => frames.push(v));
  const results = await Promise.all(
    Array.from({ length: 10 }, () => c.app.rooms.executeBotAction(command)),
  );
  expect(results.filter((x) => x === 'applied')).toHaveLength(1);
  expect(results.filter((x) => x === 'duplicate')).toHaveLength(9);
  expect(c.room().hand!.handVersion).toBe(before.handVersion + 1);
  expect(
    c.storage.raw
      .prepare(
        "SELECT COUNT(*) n FROM command_receipts WHERE actor_scope=? AND event='internal:bot'",
      )
      .get('bot:' + c.bot.botId)?.n,
  ).toBe(1);
  expect(c.room().hand!.players.reduce((n, p) => n + p.stack + p.handCommitted, 0)).toBe(4000);
  expect(frames).toEqual([]);
  expect(c.observation().recentActions.map((a) => a.actionType)).toEqual(['call', 'check']);
});
it.each(['hand', 'turn', 'version', 'participant', 'bot', 'deadline'] as const)(
  'rejects a stale or forged bot %s without changing a real hand',
  async (field) => {
    const c = await context(),
      before = c.room().hand!,
      command = { ...botActionCommand(c.observation(), { type: 'check' }) };
    if (field === 'hand') command.handId = 'old';
    if (field === 'turn') command.turnId = 'old';
    if (field === 'version') command.expectedVersion--;
    if (field === 'participant') command.participantId = c.room().participants[0]!.participantId;
    if (field === 'bot') command.botId = 'not-the-bot';
    if (field === 'deadline') command.deadline++;
    expect(await c.app.rooms.executeBotAction(command)).toBe('stale');
    expect(c.room().hand).toBe(before);
  },
);
it('does not use a late result at exact deadline, after settlement or after closing', async () => {
  const c = await context(),
    command = botActionCommand(c.observation(), { type: 'check' });
  await c.clock.advanceTo(command.deadline, false);
  expect(await c.app.rooms.executeBotAction(command)).toBe('stale');
  await c.clock.advanceTo(command.deadline);
  expect(await c.app.rooms.executeBotAction(command)).toBe('stale');
  await c.app.close();
  expect(await c.app.rooms.executeBotAction(command)).toBe('stale');
});
it('rolls back a real bot receipt failure before memory replacement and pauses the room', async () => {
  const c = await context(),
    before = c.room().hand!,
    command = botActionCommand(c.observation(), { type: 'check' });
  c.storage.raw.exec(
    "CREATE TRIGGER fail_bot BEFORE INSERT ON command_receipts WHEN NEW.event='internal:bot' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  expect(await c.app.rooms.executeBotAction(command)).toBe('paused');
  expect(c.room().hand).toBe(before);
  expect(c.room().row.status).toBe('pausedFault');
  expect(c.app.database.hands.readHand(before.handId)!.handVersion).toBe(before.handVersion);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:bot'")
      .get()?.n,
  ).toBe(0);
});
