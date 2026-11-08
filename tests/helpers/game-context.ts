import { randomUUID } from 'node:crypto';
import type { Action, GameActionCommand, SeatId } from '@orbit/protocol';
import {
  createDeck,
  getHandLegalActions,
  type CardId,
} from '../../packages/poker-core/src/index.js';
import { roomContext } from './room-context.js';
export async function gameContext(
  input: {
    players?: 2 | 3 | 4;
    dealerSeatId?: SeatId;
    stacks?: readonly number[];
    deck?: readonly CardId[];
    serverClock?: import('../../apps/server/src/game/turn-timer.js').ServerClock;
  } = {},
) {
  const n = input.players ?? 2,
    c = await roomContext({
      handDeck: () => input.deck ?? createDeck(),
      randomInt: () => input.dealerSeatId ?? 0,
      ...(input.serverClock ? { serverClock: input.serverClock } : {}),
    });
  try {
    const humans = [await c.guest('A')],
      created = await c.command(humans[0]!.socket, 'room:create', {
        commandId: randomUUID(),
        capacity: 4,
        nickname: 'A',
      });
    if (!created.ok) throw new Error(created.code);
    const roomId = created.roomId;
    for (let i = 1; i < n; i++) {
      const h = await c.guest(String.fromCharCode(65 + i));
      humans.push(h);
      const r = await c.command(h.socket, 'room:join', {
        commandId: randomUUID(),
        roomCode: c.readRoom(roomId).row.roomCode,
        nickname: String.fromCharCode(65 + i),
      });
      if (!r.ok) throw new Error(r.code);
    }
    if (input.stacks) {
      const before = c.readRoom(roomId),
        participants = before.participants.map((p) => ({ ...p, stack: input.stacks![p.seatId]! }));
      for (const p of participants)
        c.storage.raw
          .prepare('UPDATE participants SET stack=? WHERE participant_id=?')
          .run(p.stack, p.participantId);
      c.app.rooms.store.replace({ ...before, participants });
    }
    for (const h of humans) {
      const r = await c.command(h.socket, 'room:ready', {
        commandId: randomUUID(),
        roomId,
        expectedRoomVersion: c.readRoom(roomId).row.roomVersion,
        ready: true,
      });
      if (!r.ok) throw new Error(r.code);
    }
    const start = await c.command(humans[0]!.socket, 'room:start', {
      commandId: randomUUID(),
      roomId,
      expectedRoomVersion: c.readRoom(roomId).row.roomVersion,
    });
    if (!start.ok) throw new Error(start.code);
    const hand = () => c.readRoom(roomId).hand!;
    const actor = () => humans[hand().betting!.actorSeatId!]!;
    const actionCommand = (
      action: Action,
      patch: Partial<GameActionCommand> = {},
    ): GameActionCommand => ({
      commandId: randomUUID(),
      roomId,
      handId: hand().handId,
      turnId: hand().turnId!,
      expectedVersion: hand().handVersion,
      action,
      ...patch,
    });
    return {
      ...c,
      roomId,
      humans,
      hand,
      actor,
      actionCommand,
      async play(action: Action) {
        return c.command(actor().socket, 'game:action', actionCommand(action));
      },
      async passive() {
        let count = 0;
        while (hand().phase !== 'settled' && count < 100) {
          const legal = getHandLegalActions(hand(), hand().betting!.actorSeatId!);
          const type = legal.allowed.includes('check')
            ? 'check'
            : legal.allowed.includes('call')
              ? 'call'
              : 'allIn';
          const r = await c.command(actor().socket, 'game:action', actionCommand({ type }));
          if (!r.ok) throw new Error(r.code);
          count++;
        }
        if (hand().phase !== 'settled') throw new Error('ACTION_LIMIT');
        return count;
      },
    };
  } catch (error) {
    await c.close();
    throw error;
  }
}
