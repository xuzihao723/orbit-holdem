import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { gameContext } from '../helpers/game-context.js';
import { allInLeaveScenario } from '../helpers/lifecycle-scenarios.js';
async function list(c: Awaited<ReturnType<typeof gameContext>>, index = 0) {
  const control = c.app.sessions.registry.getBySocket(c.humans[index]!.socket.id!)!;
  return c.app.history.executeQuery({
    event: 'history:list',
    payload: { requestId: randomUUID(), cursor: null },
    control,
    receivedAt: c.clock.now,
  });
}
test('refund-only is not a pot win, with exact 100/250/400 fixture accounting', async () => {
  const f = allInLeaveScenario(),
    c = await gameContext({ players: 3, dealerSeatId: 2, stacks: f.stacks, deck: f.deck });
  try {
    for (let i = 0; i < 3; i++) await c.play({ type: 'allIn' });
    const result = await list(c, 2);
    expect(result.ok).toBe(true);
    if (!result.ok || !('items' in result)) throw Error('HISTORY_EXPECTED');
    expect(result.items[0]).toMatchObject({
      startingStack: 400,
      endingStack: 150,
      netHandChange: -250,
      wonAnyPot: false,
    });
  } finally {
    await c.close();
  }
});
test('waiting admission, seat cashout and re-entry never rewrite the completed hand', async () => {
  const c = await gameContext();
  try {
    const newcomer = await c.guest('C');
    await c.command(newcomer.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'C',
    });
    await c.play({ type: 'fold' });
    await c.app.rooms.queue.idle();
    const oldId = c.hand().handId,
      oldResult = JSON.stringify(c.app.database.hands.readHand(oldId)!.result),
      before = await list(c);
    expect(
      c.readRoom(c.roomId).participants.find((p) => p.sessionId === newcomer.sessionId)!.stack,
    ).toBe(2000);
    const oldParticipant = c
      .readRoom(c.roomId)
      .participants.find((p) => p.sessionId === c.humans[0]!.sessionId)!.participantId;
    await c.command(c.humans[0]!.socket, 'room:leave', {
      commandId: randomUUID(),
      roomId: c.roomId,
    });
    await c.app.rooms.queue.idle();
    expect((await list(c)).ok).toBe(true);
    await c.command(c.humans[0]!.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'A',
    });
    const after = await list(c);
    if (!before.ok || !after.ok || !('items' in before) || !('items' in after))
      throw Error('HISTORY_EXPECTED');
    expect(after.items).toEqual(before.items);
    expect(after.items[0]!.participantId).toBe(oldParticipant);
    expect(JSON.stringify(c.app.database.hands.readHand(oldId)!.result)).toBe(oldResult);
  } finally {
    await c.close();
  }
});
test('a new match resets live balances while historical net and replay stay tied to the old hand', async () => {
  const c = await gameContext();
  try {
    expect((await c.play({ type: 'fold' })).ok).toBe(true);
    const oldId = c.hand().handId;
    const old = c.app.database.hands.readHand(oldId)!;
    const before = await list(c);
    const host = c.humans[0]!;
    const roomCommand = () => ({
      commandId: randomUUID(),
      roomId: c.roomId,
      expectedRoomVersion: c.readRoom(c.roomId).row.roomVersion,
    });
    expect((await c.command(host.socket, 'room:reset:propose', roomCommand())).ok).toBe(true);
    for (const human of c.humans) {
      expect(
        (await c.command(human.socket, 'room:ready', { ...roomCommand(), ready: true })).ok,
      ).toBe(true);
    }
    expect((await c.command(host.socket, 'room:start', roomCommand())).ok).toBe(true);
    const current = c.app.database.hands.readHand(c.hand().handId)!;
    expect(current.matchId).not.toBe(old.matchId);
    expect(current.startingStacks.map((p) => p.stack)).toEqual([2000, 2000]);
    const after = await list(c);
    if (!before.ok || !after.ok || !('items' in before) || !('items' in after))
      throw Error('HISTORY_EXPECTED');
    expect(after.items).toEqual(before.items);
    expect(after.items[0]).toMatchObject({ handId: oldId, netHandChange: -10 });
    const control = c.app.sessions.registry.getBySocket(host.socket.id!)!;
    const replay = await c.app.history.executeQuery({
      event: 'replay:get',
      payload: { requestId: randomUUID(), handId: oldId },
      control,
      receivedAt: c.clock.now,
    });
    expect(replay).toMatchObject({ ok: true, result: old.result });
  } finally {
    await c.close();
  }
});
