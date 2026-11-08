import type { PokerDatabase, ReceiptInsert } from '../persistence/rows.js';
import type { RoomState } from '../rooms/room-types.js';
import type { prepareAction } from './action-candidate.js';
import { projectHandResult } from './hand-result.js';
export function commitActionCandidate(
  database: PokerDatabase,
  before: RoomState,
  x: ReturnType<typeof prepareAction>,
  receipt: ReceiptInsert,
  now: number,
) {
  const hand = x.state.hand!,
    prior = database.hands.readHand(hand.handId);
  if (!prior) throw Error('MISSING_HAND_RECORD');
  const settled = hand.phase === 'settled';
  const row = {
    ...prior,
    handVersion: hand.handVersion,
    status: settled ? ('settled' as const) : ('active' as const),
    result: settled ? projectHandResult(hand, before.row.roomId, before.match.matchId) : null,
    endedAt: settled ? now : null,
  };
  database.hands.commitHandAction({
    expectedRoomVersion: before.row.roomVersion,
    room: x.state.row,
    participantWrites: x.state.participants,
    matchWrites: [x.state.match],
    ledger: [],
    receipt,
    hand: row,
    events: x.events,
    expectedHandVersion: before.hand!.handVersion,
  });
}
