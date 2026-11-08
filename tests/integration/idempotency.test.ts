import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { gameContext } from '../helpers/game-context.js';
import { request, resumeRequest } from '../helpers/session-context.js';
const contexts: Awaited<ReturnType<typeof gameContext>>[] = [];
async function context() {
  const c = await gameContext();
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it('recovers the original applied action after its first acknowledgement is deliberately discarded', async () => {
  const c = await context(),
    actor = c.actor(),
    cmd = c.actionCommand({ type: 'call' }),
    before = c.hand();
  const discarded = new Promise<void>((resolve) => {
    const discard = (ack: import('@orbit/protocol').CommandAck) => {
      if (ack.commandId !== cmd.commandId) return;
      actor.socket.off('command:ack', discard);
      resolve();
    };
    actor.socket.on('command:ack', discard);
  });
  actor.socket.emit('game:action', cmd);
  await discarded;
  await expect
    .poll(() => c.storage.db.repositories.findReceipt('session:' + actor.sessionId, cmd.commandId))
    .not.toBeNull();
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
    ok: true,
    duplicate: true,
    appliedHandVersion: before.handVersion + 1,
  });
  expect(c.hand().handVersion).toBe(before.handVersion + 1);
});
it('keeps the same UUID independent across two session action scopes', async () => {
  const c = await context(),
    commandId = randomUUID(),
    a = c.actor();
  expect(
    await c.command(a.socket, 'game:action', c.actionCommand({ type: 'call' }, { commandId })),
  ).toMatchObject({ ok: true, duplicate: false });
  const b = c.actor();
  expect(
    await c.command(b.socket, 'game:action', c.actionCommand({ type: 'check' }, { commandId })),
  ).toMatchObject({ ok: true, duplicate: false });
  expect(a.sessionId).not.toBe(b.sessionId);
  for (const h of [a, b])
    expect(c.storage.db.repositories.findReceipt('session:' + h.sessionId, commandId)).toBeTruthy();
});
it('applies ten concurrent identical real actions once and retains their original applied version', async () => {
  const c = await context(),
    before = c.hand(),
    actor = c.actor(),
    cmd = c.actionCommand({ type: 'call' }),
    acks = await c.burst(actor.socket, 'game:action', cmd, 10);
  expect(acks.every((a) => a.ok)).toBe(true);
  expect(acks.filter((a) => !a.duplicate)).toHaveLength(1);
  expect(acks.filter((a) => a.duplicate)).toHaveLength(9);
  const after = c.hand();
  expect(after.handVersion).toBe(before.handVersion + 1);
  expect(after.players[0]!.stack).toBe(before.players[0]!.stack - 10);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM hand_events WHERE hand_id=? AND kind='actionApplied'")
      .get(before.handId)?.n,
  ).toBe(1);
  expect(
    await c.command(actor.socket, 'game:action', { ...cmd, action: { type: 'fold' } }),
  ).toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  expect(
    await c.command(actor.socket, 'game:action', {
      ...cmd,
      expectedVersion: cmd.expectedVersion + 1,
    }),
  ).toMatchObject({ code: 'COMMAND_ID_CONFLICT' });
  expect(
    await c.command(actor.socket, 'game:action', { ...cmd, roomId: 'other-room' }),
  ).toMatchObject({ code: 'COMMAND_ID_CONFLICT', roomId: null });
  expect((await c.play({ type: 'check' })).ok).toBe(true);
  const current = c.hand();
  expect(
    await c.command(actor.socket, 'game:action', {
      action: { type: 'call' },
      expectedVersion: cmd.expectedVersion,
      turnId: cmd.turnId,
      handId: cmd.handId,
      roomId: cmd.roomId,
      commandId: cmd.commandId,
    }),
  ).toMatchObject({ ok: true, duplicate: true, appliedHandVersion: after.handVersion });
  expect(c.hand()).toBe(current);
  expect(
    c.storage.db.repositories.findReceipt('session:' + actor.sessionId, cmd.commandId),
  ).toMatchObject({ appliedHandVersion: after.handVersion });
});
it('replays an original business rejection after the hand advances and does not change its state', async () => {
  const c = await context(),
    actor = c.actor(),
    cmd = c.actionCommand({ type: 'check' }),
    before = c.hand();
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
    ok: false,
    code: 'ILLEGAL_ACTION',
  });
  expect(c.hand()).toBe(before);
  expect((await c.play({ type: 'call' })).ok).toBe(true);
  const current = c.hand();
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
    ok: false,
    code: 'ILLEGAL_ACTION',
    duplicate: true,
    latestHandVersion: before.handVersion,
  });
  expect(c.hand()).toBe(current);
});
it('rechecks an old trusted control after queued work waits through a real takeover', async () => {
  const c = await context(),
    old = c.actor(),
    before = c.hand(),
    cmd = c.actionCommand({ type: 'call' });
  let release!: () => void;
  const gate = c.app.rooms.queue.run(c.roomId, () => new Promise<void>((r) => (release = r)));
  await Promise.resolve();
  const pending = c.app.rooms.execute({
    event: 'game:action',
    payload: cmd,
    control: c.app.sessions.registry.getBySocket(old.socket.id!)!,
    receivedAt: c.clock.now,
  });
  await Promise.resolve();
  const replacement = await c.guest('Replacement');
  const resumed = request(replacement.socket, 'session:resume', resumeRequest(old.resumeToken));
  try {
    await expect
      .poll(() => c.app.sessions.registry.getCurrent(old.sessionId)?.socketId)
      .toBe(replacement.socket.id);
  } finally {
    release();
  }
  await gate;
  expect((await resumed).ok).toBe(true);
  expect(await pending).toMatchObject({ code: 'SESSION_TAKEN_OVER' });
  expect(old.socket.connected).toBe(true);
  expect(c.hand()).toBe(before);
  expect(
    c.storage.db.repositories.findReceipt('session:' + old.sessionId, cmd.commandId),
  ).toBeNull();
});
it('retains terminal receipts for an old action without reapplying after settlement', async () => {
  const c = await context(),
    actor = c.actor(),
    cmd = c.actionCommand({ type: 'fold' });
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({ ok: true });
  const end = c.hand();
  expect(end.phase).toBe('settled');
  expect(await c.command(actor.socket, 'game:action', cmd)).toMatchObject({
    ok: true,
    duplicate: true,
    appliedHandVersion: end.handVersion,
  });
  expect(c.hand()).toBe(end);
  const count = c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n;
  expect(
    await c.command(actor.socket, 'game:action', { ...cmd, commandId: randomUUID() }),
  ).toMatchObject({ code: 'HAND_MISMATCH' });
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(count);
});
