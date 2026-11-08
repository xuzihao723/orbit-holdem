import type { HandResult, CardPair } from '@orbit/protocol';
import type { HandState } from '@orbit/poker-core';
export function projectHandResult(state: HandState, roomId: string, matchId: string): HandResult {
  const result = state.result;
  if (!result) throw new Error('HAND_NOT_SETTLED');
  const id = (seat: number) => {
    const p = state.players.find((p) => p.seatId === seat);
    if (!p) throw new Error('UNKNOWN_HAND_SEAT');
    return p.participantId;
  };
  return {
    roomId,
    matchId,
    handId: state.handId,
    handVersion: state.handVersion,
    phase: 'settled',
    board: [...state.board],
    showdownCards: result.showdownCards.map((p) => ({
      participantId: id(p.seatId),
      cards: [...p.cards] as CardPair,
    })),
    pots: result.settlement.plan.pots.map((p) => ({
      potId: p.potId,
      amount: p.amount,
      eligibleParticipantIds: p.eligibleSeatIds.map(id),
      winnerParticipantIds: p.winnerSeatIds.map(id),
      allocations: p.allocations.map((a) => ({ participantId: id(a.seatId), amount: a.amount })),
      winningCategory: p.winningCategory,
    })),
    refunds: result.refunds.map((r) => ({ participantId: id(r.seatId), amount: r.amount })),
    finalStacks: state.players.map((p) => ({
      participantId: p.participantId,
      seatId: p.seatId,
      stack: p.stack,
    })),
    reason: result.reason,
  };
}
