import type { HandPublicState, CardPair } from '@orbit/protocol';
import type { RoomState } from '../rooms/room-types.js';
export function projectPublicHand(
  room: RoomState,
  deadline: number | null = room.turnClock?.deadline ?? null,
): HandPublicState | null {
  const hand = room.hand;
  if (!hand) return null;
  const revealed = hand.result?.showdownCards ?? [];
  return {
    roomId: room.row.roomId,
    matchId: room.match.matchId,
    handId: hand.handId,
    handVersion: hand.handVersion,
    phase: hand.phase,
    dealerSeatId: hand.positions.dealerSeatId,
    smallBlindSeatId: hand.positions.smallBlindSeatId,
    bigBlindSeatId: hand.positions.bigBlindSeatId,
    players: hand.players.map((p) => ({
      participantId: p.participantId,
      seatId: p.seatId,
      stack: p.stack,
      streetCommitted: p.streetCommitted,
      handCommitted: p.handCommitted,
      folded: p.folded,
      allIn: p.allIn,
      hiddenCardCount: revealed.some((r) => r.seatId === p.seatId) ? 0 : 2,
    })),
    board: [...hand.board],
    showdownCards: revealed.map((p) => ({
      participantId: hand.players.find((v) => v.seatId === p.seatId)!.participantId,
      cards: [...p.cards] as CardPair,
    })),
    pots: [],
    potTotal: hand.players.reduce((n, p) => n + p.handCommitted, 0),
    actorSeatId: hand.betting?.actorSeatId ?? null,
    turnId: hand.turnId,
    deadline,
    publicEventSequence: room.publicEventSequence,
  };
}
