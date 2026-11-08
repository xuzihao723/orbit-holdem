import type { HandState, PreviousPositions } from '@orbit/poker-core';
import type { ServerEventMap, ErrorCode } from '@orbit/protocol';
import type { RoomRow, ParticipantRow, MatchRow } from '../persistence/domain-rows.js';
export interface RoomState {
  readonly publicActions?: readonly {
    sequence: number;
    seatId: import('@orbit/protocol').SeatId;
    actionType: import('@orbit/protocol').Action['type'];
    paidAmount: number;
    raiseTo: number | null;
  }[];
  readonly boundaryPending?: boolean;
  readonly turnClock?: import('../game/turn-timer.js').TurnClock | null;
  readonly joinedPublicSequences?: Readonly<Record<string, number>>;
  readonly publicEventSequence: number;
  readonly row: RoomRow;
  readonly participants: readonly ParticipantRow[];
  readonly match: MatchRow;
  readonly hand: HandState | null;
  readonly previous: PreviousPositions | null;
}
export type Publication = {
  [K in keyof ServerEventMap]: { socketId: string; event: K; payload: ServerEventMap[K] };
}[keyof ServerEventMap];
export class RoomError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
export function nextVersion(v: number) {
  if (!Number.isSafeInteger(v) || v >= Number.MAX_SAFE_INTEGER) throw new RoomError('ROOM_PAUSED');
  return v + 1;
}
