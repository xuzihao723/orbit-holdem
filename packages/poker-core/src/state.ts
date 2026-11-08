import { createDeckState, dealHoleCards, type SeatId } from './deck.js';
import { postBlinds, resolvePositions } from './positions.js';
import { beginBettingRound, applyBettingAction, getRoundOutcome } from './betting-round.js';
import { getLegalActions } from './betting-amounts.js';
import type { CoreLegalActions } from './betting-types.js';
import type { CreateHandInput, HandState, HandActionResult } from './hand-types.js';
import { handRound, mergeHandRound } from './hand-betting.js';
import { complete, emit, nextCounter, type HandWork, freezeData } from './hand-internal.js';
import { progressHand } from './hand-progress.js';
export function createHand(input: CreateHandInput) {
  if (
    !input ||
    typeof input.handId !== 'string' ||
    !input.handId.trim() ||
    !Array.isArray(input.players)
  )
    throw new Error('INVALID_HAND_INPUT');
  const identities = new Set<string>();
  for (const p of input.players) {
    if (
      !p ||
      typeof p.participantId !== 'string' ||
      !p.participantId.trim() ||
      identities.has(p.participantId)
    )
      throw new Error('INVALID_HAND_INPUT');
    identities.add(p.participantId);
  }
  const players = [...input.players].sort((a, b) => a.seatId - b.seatId),
    positions = resolvePositions(
      players.map((p) => p.seatId),
      input.dealerSeatId,
    );
  const deck = createDeckState(input.deck),
    blinds = postBlinds(players, positions),
    dealt = dealHoleCards(
      deck,
      players.map((p) => p.seatId),
      input.dealerSeatId,
    );
  const state: HandState = {
    handId: input.handId,
    handVersion: 1,
    turnSerial: 0,
    turnId: null,
    phase: 'preflop',
    positions,
    initialChipTotal: blinds.initialChipTotal,
    players: blinds.players.map((p) => ({
      ...p,
      participantId: players.find((s) => s.seatId === p.seatId)!.participantId,
      startingStack: players.find((s) => s.seatId === p.seatId)!.stack,
      holeCards: dealt.holeCards[p.seatId]!,
    })),
    deck: dealt.deck,
    burnCards: [],
    board: [],
    betting: null,
    issuedRefunds: [],
    eventSequence: 0,
    settlementCount: 0,
    result: null,
  };
  const work: HandWork = {
    state: mergeHandRound(
      state,
      beginBettingRound({
        street: 'preflop',
        bigBlind: 20,
        players: state.players,
        actionOrder: positions.preflopOrder,
      }),
    ),
    events: [],
  };
  emit(work, {
    kind: 'handStarted',
    visibility: 'public',
    dealerSeatId: input.dealerSeatId,
    seats: players.map((p) => p.seatId),
  });
  for (const p of work.state.players)
    if (p.streetCommitted > 0)
      emit(work, {
        kind: 'blindPosted',
        visibility: 'public',
        seatId: p.seatId,
        amount: p.streetCommitted,
      });
  for (const seat of positions.dealOrder)
    emit(work, {
      kind: 'holeDealt',
      visibility: 'owner',
      seatId: seat,
      cards: work.state.players.find((p) => p.seatId === seat)!.holeCards,
    });
  progressHand(work);
  return complete(work);
}
export function getHandLegalActions(state: HandState, seatId: SeatId): CoreLegalActions {
  if (state.phase === 'settled')
    return freezeData({
      allowed: [],
      callAmount: 0,
      minRaiseTo: null,
      maxRaiseTo: null,
      allIn: null,
    });
  return getLegalActions(handRound(state), seatId);
}
export function applyHandAction(
  state: HandState,
  input: { readonly seatId: SeatId; readonly turnId: string; readonly action: unknown },
): HandActionResult {
  if (state.phase === 'settled')
    return Object.freeze({
      ok: false,
      reason: 'HAND_SETTLED',
      state,
      events: Object.freeze([] as const),
    });
  if (input.turnId !== state.turnId)
    return Object.freeze({
      ok: false,
      reason: 'TURN_MISMATCH',
      state,
      events: Object.freeze([] as const),
    });
  const applied = applyBettingAction(handRound(state), input.seatId, input.action);
  if (!applied.ok)
    return Object.freeze({
      ok: false,
      reason: applied.reason,
      state,
      events: Object.freeze([] as const),
    });
  const work: HandWork = {
    state: mergeHandRound(
      { ...state, handVersion: nextCounter(state.handVersion), turnId: null },
      applied.state,
    ),
    events: [],
  };
  const allIn =
    typeof input.action === 'object' &&
    input.action !== null &&
    Object.getOwnPropertyDescriptor(input.action, 'type')?.value === 'allIn';
  emit(work, {
    kind: 'actionApplied',
    visibility: 'public',
    seatId: input.seatId,
    actionType: allIn ? 'allIn' : applied.effect.kind,
    paidAmount: applied.effect.paidAmount,
    raiseTo:
      applied.effect.kind === 'bet' || applied.effect.kind === 'raise'
        ? applied.effect.currentBet
        : null,
  });
  progressHand(work);
  const result = complete(work);
  return Object.freeze({ ok: true, ...result });
}
export function advanceHand(state: HandState) {
  if (state.phase === 'settled')
    return Object.freeze({ state, events: Object.freeze([] as const) });
  if (getRoundOutcome(handRound(state)) === 'continue')
    return Object.freeze({ state, events: Object.freeze([] as const) });
  const work: HandWork = {
    state: { ...state, handVersion: nextCounter(state.handVersion), turnId: null },
    events: [],
  };
  progressHand(work);
  return complete(work);
}
