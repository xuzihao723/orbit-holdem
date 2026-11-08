import type { RoomState } from '../rooms/room-types.js';
import type { BotObservation } from './bot-types.js';
import { getHandLegalActions } from '@orbit/poker-core';
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}
export function projectBotObservation(state: RoomState, botId: string): BotObservation | null {
  const hand = state.hand,
    member = state.participants.find(
      (p) =>
        p.botId === botId && p.sessionId === null && p.leftAt === null && p.admission === 'active',
    );
  if (
    state.row.status !== 'playing' ||
    !hand ||
    !hand.turnId ||
    !state.turnClock ||
    !member ||
    !['preflop', 'flop', 'turn', 'river'].includes(hand.phase)
  )
    return null;
  const own = hand.players.find(
    (p) => p.participantId === member.participantId && p.seatId === member.seatId,
  );
  if (!own || own.folded || own.allIn || hand.betting?.actorSeatId !== own.seatId) return null;
  const legal = getHandLegalActions(hand, own.seatId);
  return freeze({
    roomId: state.row.roomId,
    handId: hand.handId,
    turnId: hand.turnId,
    handVersion: hand.handVersion,
    participantId: own.participantId,
    botId,
    seatId: own.seatId,
    holeCards: [own.holeCards[0], own.holeCards[1]],
    board: [...hand.board],
    phase: hand.phase as BotObservation['phase'],
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
      hiddenCardCount: 2,
    })),
    legalActions: {
      allowed: [...legal.allowed],
      callAmount: legal.callAmount,
      minRaiseTo: legal.minRaiseTo,
      maxRaiseTo: legal.maxRaiseTo,
      allIn: legal.allIn
        ? {
            raiseTo: legal.allIn.raiseTo,
            additionalAmount: legal.allIn.additionalAmount,
            kind: legal.allIn.kind,
          }
        : null,
    },
    potTotal: hand.players.reduce((n, p) => n + p.handCommitted, 0),
    deadline: state.turnClock.deadline,
    recentActions: (state.publicActions ?? []).slice(-64).map((p) => ({
      sequence: p.sequence,
      seatId: p.seatId,
      actionType: p.actionType,
      paidAmount: p.paidAmount,
      raiseTo: p.raiseTo,
    })),
  });
}
