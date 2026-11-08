import type { SeatId } from './deck.js';
import type {
  Action,
  ActionFailureReason,
  AmountResult,
  BettingPlayer,
  BettingRound,
  CoreLegalActions,
  BettingEffect,
} from './betting-types.js';

const safe = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const canAct = (player: BettingPlayer): boolean =>
  !player.folded && !player.allIn && player.stack > 0;
const isSeat = (value: unknown): value is SeatId => safe(value) && value < 4;
function invalid(): never {
  throw new Error('INVALID_BETTING_STATE');
}

export function assertBettingRound(round: BettingRound): void {
  if (
    !round ||
    !['preflop', 'flop', 'turn', 'river'].includes(round.street) ||
    !safe(round.bigBlind) ||
    round.bigBlind === 0 ||
    !safe(round.currentBet) ||
    !safe(round.lastFullRaiseSize) ||
    round.lastFullRaiseSize === 0 ||
    !Array.isArray(round.players) ||
    round.players.length < 2 ||
    round.players.length > 4
  )
    invalid();
  const ids: SeatId[] = [];
  let total = 0;
  for (const p of round.players) {
    if (
      !p ||
      !isSeat(p.seatId) ||
      ids.includes(p.seatId) ||
      !safe(p.stack) ||
      !safe(p.streetCommitted) ||
      !safe(p.handCommitted) ||
      p.handCommitted < p.streetCommitted ||
      p.streetCommitted > round.currentBet ||
      typeof p.folded !== 'boolean' ||
      typeof p.allIn !== 'boolean' ||
      (p.allIn && p.stack !== 0) ||
      (p.lastActedAtBet !== null &&
        (!safe(p.lastActedAtBet) || p.lastActedAtBet > round.currentBet))
    )
      invalid();
    ids.push(p.seatId);
    total += p.stack + p.handCommitted;
    if (!safe(total)) invalid();
  }
  if (
    !Array.isArray(round.actionOrder) ||
    round.actionOrder.length !== ids.length ||
    new Set(round.actionOrder).size !== ids.length ||
    Array.from(round.actionOrder).some((s) => !isSeat(s) || !ids.includes(s))
  )
    invalid();
  const sorted = [...ids].sort((a, b) => a - b),
    start = sorted.indexOf(round.actionOrder[0]!);
  if (round.actionOrder.some((s, i) => s !== sorted[(start + i) % sorted.length])) invalid();
  if (
    !Array.isArray(round.pendingSeatIds) ||
    new Set(round.pendingSeatIds).size !== round.pendingSeatIds.length ||
    Array.from(round.pendingSeatIds).some(
      (s) => !isSeat(s) || !round.players.some((p) => p.seatId === s && canAct(p)),
    )
  )
    invalid();
  if (
    round.pendingSeatIds.length === 0
      ? round.actorSeatId !== null
      : !isSeat(round.actorSeatId) || round.pendingSeatIds[0] !== round.actorSeatId
  )
    invalid();
}

export function hasRaiseRight(round: BettingRound, seatId: SeatId): boolean {
  assertBettingRound(round);
  const p = round.players.find((p) => p.seatId === seatId);
  return (
    !!p &&
    canAct(p) &&
    (p.lastActedAtBet === null || round.currentBet - p.lastActedAtBet >= round.lastFullRaiseSize)
  );
}
export function getResponsiveOpponentSeatIds(
  round: BettingRound,
  seatId: SeatId,
): readonly SeatId[] {
  assertBettingRound(round);
  return Object.freeze(
    round.actionOrder.filter(
      (s) => s !== seatId && round.players.some((p) => p.seatId === s && canAct(p)),
    ),
  );
}
export function getLegalActions(round: BettingRound, seatId: SeatId): CoreLegalActions {
  assertBettingRound(round);
  const p = round.players.find((p) => p.seatId === seatId);
  if (!p || seatId !== round.actorSeatId || !canAct(p))
    return Object.freeze({
      allowed: Object.freeze([]),
      callAmount: 0,
      minRaiseTo: null,
      maxRaiseTo: null,
      allIn: null,
    });
  const gap = round.currentBet - p.streetCommitted,
    cap = p.streetCommitted + p.stack;
  const mayRaise =
    hasRaiseRight(round, seatId) && getResponsiveOpponentSeatIds(round, seatId).length > 0;
  const min = round.currentBet === 0 ? round.bigBlind : round.currentBet + round.lastFullRaiseSize;
  const full = mayRaise && safe(min) && min <= cap && cap > round.currentBet;
  const allowed: Action['type'][] = ['fold'];
  if (gap === 0) allowed.push('check');
  else if (gap < p.stack) allowed.push('call');
  if (full) allowed.push(round.currentBet === 0 ? 'bet' : 'raise');
  const allIn =
    cap <= round.currentBet || mayRaise
      ? Object.freeze({
          raiseTo: cap,
          additionalAmount: p.stack,
          kind:
            cap <= round.currentBet
              ? ('call' as const)
              : round.currentBet === 0
                ? ('bet' as const)
                : ('raise' as const),
        })
      : null;
  if (allIn) allowed.push('allIn');
  return Object.freeze({
    allowed: Object.freeze(allowed),
    callAmount: gap,
    minRaiseTo: full ? min : null,
    maxRaiseTo: full ? cap : null,
    allIn,
  });
}

type ParsedAction =
  | Exclude<Action, { readonly type: 'bet' | 'raise'; readonly raiseTo: number }>
  | { readonly type: 'bet' | 'raise'; readonly raiseTo: unknown };
function parseAction(value: unknown): ParsedAction | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return null;
  const descriptors = Object.getOwnPropertyDescriptors(value),
    type = descriptors.type?.value as unknown;
  if (
    typeof type !== 'string' ||
    !['fold', 'check', 'call', 'bet', 'raise', 'allIn'].includes(type)
  )
    return null;
  const keys = Reflect.ownKeys(value),
    needsAmount = type === 'bet' || type === 'raise';
  if (
    keys.length !== (needsAmount ? 2 : 1) ||
    keys.some((k) => k !== 'type' && (!needsAmount || k !== 'raiseTo')) ||
    Object.values(descriptors).some((d) => !('value' in d))
  )
    return null;
  // Copy only validated own data properties; amount validation keeps its own reason.
  if (type === 'bet' || type === 'raise')
    return { type, raiseTo: descriptors.raiseTo?.value as unknown };
  if (type === 'fold' || type === 'check' || type === 'call' || type === 'allIn') return { type };
  return null;
}
export function applyBettingAmount(
  round: BettingRound,
  seatId: SeatId,
  value: unknown,
): AmountResult {
  assertBettingRound(round);
  const reject = (reason: ActionFailureReason): AmountResult => ({
    ok: false,
    reason,
    state: round,
  });
  if (seatId !== round.actorSeatId) return reject('NOT_YOUR_TURN');
  const action = parseAction(value);
  if (!action) return reject('ILLEGAL_ACTION');
  const player = round.players.find((p) => p.seatId === seatId)!;
  const legal = getLegalActions(round, seatId);
  let target = player.streetCommitted;
  if (action.type === 'bet' || action.type === 'raise') {
    const minimum =
      round.currentBet === 0 ? round.bigBlind : round.currentBet + round.lastFullRaiseSize;
    if (
      !safe(action.raiseTo) ||
      !safe(minimum) ||
      action.raiseTo < minimum ||
      action.raiseTo > player.streetCommitted + player.stack
    )
      return reject('ILLEGAL_AMOUNT');
    target = action.raiseTo;
  } else if (action.type === 'allIn') {
    target = player.streetCommitted + player.stack;
  } else if (action.type === 'call') {
    target = round.currentBet;
  }
  if (!legal.allowed.includes(action.type)) return reject('ILLEGAL_ACTION');
  const paidAmount = target - player.streetCommitted,
    currentBet = Math.max(round.currentBet, target),
    increment = currentBet - round.currentBet;
  const raiseClass =
    increment === 0 ? 'none' : increment >= round.lastFullRaiseSize ? 'full' : 'short';
  const players = Object.freeze(
    round.players.map((p) =>
      Object.freeze(
        p.seatId === seatId
          ? {
              ...p,
              stack: p.stack - paidAmount,
              streetCommitted: target,
              handCommitted: p.handCommitted + paidAmount,
              folded: action.type === 'fold' || p.folded,
              allIn: p.stack - paidAmount === 0,
            }
          : { ...p },
      ),
    ),
  );
  const kind =
    action.type === 'allIn'
      ? target <= round.currentBet
        ? 'call'
        : round.currentBet === 0
          ? 'bet'
          : 'raise'
      : action.type;
  const effect: BettingEffect = Object.freeze({
    actingSeatId: seatId,
    players,
    currentBet,
    lastFullRaiseSize: raiseClass === 'full' ? increment : round.lastFullRaiseSize,
    paidAmount,
    kind,
    isAllIn: players.find((p) => p.seatId === seatId)!.allIn,
    raiseClass,
  });
  return { ok: true, effect };
}
