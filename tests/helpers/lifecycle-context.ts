import { randomUUID } from 'node:crypto';
import { roomContext } from './room-context.js';
import { FakeClock } from './fake-clock.js';
import { createDeck } from '../../packages/poker-core/src/index.js';
import type { Action } from '@orbit/protocol';
import { prepareAction } from '../../apps/server/src/game/action-candidate.js';
import { commitActionCandidate } from '../../apps/server/src/game/internal-action-handler.js';
import { commandDigest } from '../../apps/server/src/game/command-digest.js';
/** W23 component driver only: real core+SQL, before W24/W25 production bot commands. */
export async function trustedLifecycleAction(
  c: Awaited<ReturnType<typeof lifecycleContext>>,
  action: Action,
) {
  const state = c.room(),
    member = state.participants.find((p) => p.seatId === state.hand!.betting!.actorSeatId)!,
    token = { ...state.turnClock!, roomId: c.roomId },
    now = c.clock.now(),
    commandId = 'timeout:' + state.hand!.handId + ':' + state.hand!.turnId,
    x = prepareAction(
      {
        payload: {
          commandId,
          roomId: c.roomId,
          handId: state.hand!.handId,
          turnId: state.hand!.turnId!,
          expectedVersion: state.hand!.handVersion,
          action,
        },
        receivedAt: now,
      },
      state,
      member,
      now,
      'timeout',
    ),
    receipt = {
      actorScope: 'system:' + c.roomId,
      commandId,
      payloadHash: commandDigest('internal:timeout', token),
      event: 'internal:timeout',
      result: {
        kind: 'internalApplied',
        roomId: c.roomId,
        roomVersion: x.state.row.roomVersion,
        handId: x.state.hand!.handId,
        handVersion: x.state.hand!.handVersion,
      },
      roomId: c.roomId,
      appliedRoomVersion: x.state.row.roomVersion,
      handId: x.state.hand!.handId,
      appliedHandVersion: x.state.hand!.handVersion,
      createdAt: now,
    };
  commitActionCandidate(c.app.database, state, x, receipt, now);
  c.app.rooms.store.replace(x.state);
  if (x.state.hand?.phase === 'settled') await c.app.rooms.executeBoundary(c.roomId);
}
export async function lifecycleContext(
  input: {
    players?: 1 | 2 | 3 | 4;
    bots?: number;
    capacity?: 2 | 3 | 4;
    difficulty?: 'basic' | 'standard';
    botOptions?: import('../../apps/server/src/bots/bot-types.js').BotOptions;
    workerPoolOptions?: import('../../apps/server/src/bots/worker-pool.js').WorkerPoolOptions;
  } = {},
) {
  const clock = new FakeClock(),
    c = await roomContext({
      serverClock: clock,
      handDeck: createDeck,
      randomInt: () => 0,
      ...(input.botOptions ? { botOptions: input.botOptions } : {}),
      ...(input.workerPoolOptions ? { workerPoolOptions: input.workerPoolOptions } : {}),
    });
  try {
    const humans = [await c.guest('A')],
      made = await c.command(humans[0]!.socket, 'room:create', {
        commandId: randomUUID(),
        capacity: input.capacity ?? 4,
        nickname: 'A',
      });
    if (!made.ok) throw Error(made.code);
    const roomId = made.roomId,
      room = () => c.readRoom(roomId),
      version = () => ({
        commandId: randomUUID(),
        roomId,
        expectedRoomVersion: room().row.roomVersion,
      });
    for (let i = 1; i < (input.players ?? 2); i++) {
      const h = await c.guest(String.fromCharCode(65 + i));
      humans.push(h);
      const ack = await c.command(h.socket, 'room:join', {
        commandId: randomUUID(),
        roomCode: room().row.roomCode,
        nickname: String.fromCharCode(65 + i),
      });
      if (!ack.ok) throw Error(ack.code);
    }
    for (let i = 0; i < (input.bots ?? 0); i++) {
      const ack = await c.command(humans[0]!.socket, 'room:bot:add', {
        ...version(),
        difficulty: input.difficulty ?? 'basic',
        seatId: ((input.players ?? 2) + i) as 0 | 1 | 2 | 3,
      });
      if (!ack.ok) throw Error(ack.code);
    }
    clock.flush = () => c.app.rooms.queue.idle();
    const start = async () => {
      for (const h of humans) {
        const ack = await c.command(h.socket, 'room:ready', { ...version(), ready: true });
        if (!ack.ok) throw Error(ack.code);
      }
      const ack = await c.command(humans[0]!.socket, 'room:start', version());
      if (!ack.ok) throw Error(ack.code);
      return ack;
    };
    return { ...c, clock, roomId, room, humans, version, start };
  } catch (e) {
    await c.close();
    throw e;
  }
}
