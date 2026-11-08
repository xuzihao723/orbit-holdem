import type { SeatId } from './deck.js';
import type {
  BettingPlayer,
  BettingRound,
  Street,
  RoundOutcome,
  RoundActionResult,
} from './betting-types.js';
import { applyBettingAmount, assertBettingRound, canAct } from './betting-amounts.js';

function invalid(): never {
  throw new Error('INVALID_BETTING_STATE');
}

function requiredSeats(
  players: readonly BettingPlayer[],
  currentBet: number,
  pending: readonly SeatId[],
): readonly SeatId[] {
  const alive = players.filter((p) => !p.folded),
    active = players.filter(canAct);
  if (alive.length === 0) invalid();
  if (alive.length === 1 || active.length === 0) return [];
  if (active.length === 1)
    return active[0]!.streetCommitted < currentBet ? [active[0]!.seatId] : [];
  return pending.filter((s) => active.some((p) => p.seatId === s));
}
function freezeRound(round: BettingRound): BettingRound {
  return Object.freeze({
    ...round,
    players: Object.freeze(round.players.map((p) => Object.freeze({ ...p }))),
    actionOrder: Object.freeze([...round.actionOrder]),
    pendingSeatIds: Object.freeze([...round.pendingSeatIds]),
  });
}
function assertCompleteRound(round: BettingRound): void {
  assertBettingRound(round);
  const alive = round.players.filter((p) => !p.folded),
    active = round.players.filter(canAct);
  if (alive.length === 0) invalid();
  const normalized = requiredSeats(round.players, round.currentBet, round.pendingSeatIds);
  if (
    normalized.length !== round.pendingSeatIds.length ||
    normalized.some((s) => !round.pendingSeatIds.includes(s))
  )
    invalid();
  if (alive.length > 1)
    for (const p of active) {
      if (
        (p.streetCommitted < round.currentBet ||
          (active.length > 1 && p.lastActedAtBet === null)) &&
        !round.pendingSeatIds.includes(p.seatId)
      )
        invalid();
    }
  if (round.actorSeatId !== null) {
    const start = round.actionOrder.indexOf(round.actorSeatId),
      cycle = [...round.actionOrder.slice(start), ...round.actionOrder.slice(0, start)].filter(
        (s) => round.pendingSeatIds.includes(s),
      );
    if (cycle.some((s, i) => s !== round.pendingSeatIds[i])) invalid();
  }
}
export function beginBettingRound(input: {
  readonly street: Street;
  readonly bigBlind: 20;
  readonly players: readonly BettingPlayer[];
  readonly actionOrder: readonly SeatId[];
}): BettingRound {
  if (
    !input ||
    input.bigBlind !== 20 ||
    !Array.isArray(input.players) ||
    !Array.isArray(input.actionOrder)
  )
    invalid();
  // Validate the caller's original monetary state before resetting street fields.
  const priorLine = Math.max(
    0,
    ...input.players.map((p) => p?.streetCommitted ?? NaN),
    ...input.players.map((p) => p?.lastActedAtBet ?? 0),
  );
  assertBettingRound({
    street: input.street,
    bigBlind: input.bigBlind,
    currentBet: priorLine,
    lastFullRaiseSize: 20,
    players: input.players,
    actionOrder: input.actionOrder,
    pendingSeatIds: [],
    actorSeatId: null,
  });
  const currentBet = input.street === 'preflop' ? 20 : 0;
  const players = input.players.map((p) => ({
    ...p,
    streetCommitted: input.street === 'preflop' ? p.streetCommitted : 0,
    lastActedAtBet: null,
  }));
  const activeOrder = input.actionOrder.filter((s) =>
    players.some((p) => p.seatId === s && canAct(p)),
  );
  const pendingSeatIds = requiredSeats(players, currentBet, activeOrder);
  const round = freezeRound({
    street: input.street,
    bigBlind: 20,
    currentBet,
    lastFullRaiseSize: 20,
    players,
    actionOrder: input.actionOrder,
    pendingSeatIds,
    actorSeatId: pendingSeatIds[0] ?? null,
  });
  assertCompleteRound(round);
  return round;
}
export function getRoundOutcome(round: BettingRound): RoundOutcome {
  assertCompleteRound(round);
  if (round.players.filter((p) => !p.folded).length === 1) return 'uncontested';
  if (round.pendingSeatIds.length > 0) return 'continue';
  if (round.players.filter(canAct).length < 2) return 'runout';
  return 'streetComplete';
}
export function applyBettingAction(
  round: BettingRound,
  seatId: SeatId,
  action: unknown,
): RoundActionResult {
  assertCompleteRound(round);
  const result = applyBettingAmount(round, seatId, action);
  if (!result.ok) return result;
  const effect = result.effect;
  const players = effect.players.map((p) =>
    p.seatId === seatId ? { ...p, lastActedAtBet: effect.currentBet } : p,
  );
  const pending = new Set(round.pendingSeatIds.filter((s) => s !== seatId));
  if (effect.currentBet > round.currentBet)
    for (const p of players) {
      if (
        p.seatId !== seatId &&
        canAct(p) &&
        (effect.raiseClass === 'full' || p.streetCommitted < effect.currentBet)
      )
        pending.add(p.seatId);
    }
  const normalized = requiredSeats(players, effect.currentBet, [...pending]);
  const index = round.actionOrder.indexOf(seatId);
  const cycle = [...round.actionOrder.slice(index + 1), ...round.actionOrder.slice(0, index + 1)];
  const pendingSeatIds = cycle.filter((s) => normalized.includes(s));
  const state = freezeRound({
    ...round,
    players,
    currentBet: effect.currentBet,
    lastFullRaiseSize: effect.lastFullRaiseSize,
    pendingSeatIds,
    actorSeatId: pendingSeatIds[0] ?? null,
  });
  return { ok: true, state, effect, outcome: getRoundOutcome(state) };
}
