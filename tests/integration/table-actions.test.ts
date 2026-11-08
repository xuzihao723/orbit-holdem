import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { roomContext } from '../helpers/room-context.js';
import { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import { currentActionKey } from '../../apps/web/src/features/table/action-draft.js';
test('real client applies a raise total exactly once and cannot reuse it after its turn', async () => {
  const c = await roomContext(),
    a = createSocketClient({ url: c.origin }),
    b = createSocketClient({ url: c.origin });
  try {
    await a.connect();
    await b.connect();
    await a.guest('A');
    await b.guest('B');
    const created = await a.sendCommand('room:create', {
      commandId: randomUUID(),
      capacity: 2,
      nickname: 'A',
    });
    if (!created.ok) throw Error(created.code);
    await expect.poll(() => a.store.snapshot.roomView?.roomId).toBe(created.roomId);
    await b.sendCommand('room:join', {
      commandId: randomUUID(),
      roomCode: a.store.snapshot.roomView!.roomCode,
      nickname: 'B',
    });
    for (const client of [a, b]) {
      await client.resume();
      await client.sendCommand('room:ready', {
        commandId: randomUUID(),
        roomId: created.roomId,
        expectedRoomVersion: c.readRoom(created.roomId).row.roomVersion,
        ready: true,
      });
    }
    await a.sendCommand('room:start', {
      commandId: randomUUID(),
      roomId: created.roomId,
      expectedRoomVersion: c.readRoom(created.roomId).row.roomVersion,
    });
    await expect.poll(() => a.store.snapshot.playerView?.handVersion).toBe(1);
    await expect.poll(() => b.store.snapshot.playerView?.handVersion).toBe(1);
    const actor = [a, b].find((x) => currentActionKey(x.store.snapshot))!,
      v = actor.store.snapshot.playerView!;
    const player = v.players.find((p) => p.participantId === v.self.participantId)!;
    const payload = {
      commandId: randomUUID(),
      roomId: v.roomId,
      handId: v.handId,
      turnId: v.turnId!,
      expectedVersion: v.handVersion,
      action: { type: 'raise' as const, raiseTo: 100 },
    };
    const acknowledgements = await Promise.all([
      actor.sendCommand('game:action', payload),
      actor.sendCommand('game:action', payload),
    ]);
    expect(acknowledgements.every((x) => x.ok)).toBe(true);
    expect(acknowledgements.filter((x) => x.ok && x.duplicate)).toHaveLength(1);
    const hand = c.readRoom(created.roomId).hand!,
      after = hand.players.find((p) => p.participantId === player.participantId)!;
    expect(player.stack - after.stack).toBe(100 - player.streetCommitted);
    expect(hand.handVersion).toBe(2);
    await expect.poll(() => actor.store.snapshot.playerView?.handVersion).toBe(2);
    expect(currentActionKey(actor.store.snapshot)).toBe(null);
    await expect(actor.sendCommand('game:action', payload)).rejects.toThrow('STALE_ACTION');
    await expect
      .poll(() => [a, b].filter((x) => currentActionKey(x.store.snapshot)).length)
      .toBe(1);
    const other = [a, b].find((x) => currentActionKey(x.store.snapshot))!,
      next = other.store.snapshot.playerView!;
    const rejected = await other.sendCommand('game:action', {
      ...payload,
      commandId: randomUUID(),
      turnId: next.turnId!,
      expectedVersion: next.handVersion,
      action: { type: 'raise', raiseTo: 101 },
    });
    expect(rejected).toMatchObject({ ok: false, code: 'ILLEGAL_AMOUNT' });
    expect(c.readRoom(created.roomId).hand!.handVersion).toBe(2);
  } finally {
    a.close();
    b.close();
    await c.close();
  }
});
