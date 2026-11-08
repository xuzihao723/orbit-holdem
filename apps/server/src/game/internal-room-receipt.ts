import type { RoomState } from '../rooms/room-types.js';
import type { ReceiptInsert } from '../persistence/rows.js';
import { commandDigest } from './command-digest.js';
export function internalRoomReceipt(
  state: RoomState,
  event: 'internal:boundary' | 'internal:leaveFold' | 'internal:expiry',
  commandId: string,
  intent: unknown,
  now: number,
): ReceiptInsert {
  const handId = state.hand?.handId ?? null,
    handVersion = state.hand?.handVersion ?? null;
  return {
    actorScope: 'system:' + state.row.roomId,
    commandId,
    payloadHash: commandDigest(event, intent),
    event,
    result: {
      kind: 'internalApplied',
      roomId: state.row.roomId,
      roomVersion: state.row.roomVersion,
      handId,
      handVersion,
    },
    roomId: state.row.roomId,
    appliedRoomVersion: state.row.roomVersion,
    handId,
    appliedHandVersion: handVersion,
    createdAt: now,
  };
}
