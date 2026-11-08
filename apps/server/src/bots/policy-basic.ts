import type { Action } from '@orbit/protocol';
import type { BotObservation } from './bot-types.js';
import { preflopStrength } from './preflop-strength.js';
import { evaluateBest, resolvePositions } from '@orbit/poker-core';
import { adaptBotIntent } from './action-adapter.js';
export interface PolicyRandom {
  next(): number;
}
export const BASIC_POLICY = Object.freeze({
  mediumScore: 45,
  strongScore: 60,
  lateBonus: 4,
  fourSeatPenalty: 4,
  weakCost: 0.08,
  mediumCost: 0.25,
  strongCost: 0.5,
  freeBetProbability: 0.35,
  paidRaiseProbability: 0.25,
});
export function assessBasic(o: BotObservation, preflopBaseScore?: number) {
  const own = o.players.find((p) => p.participantId === o.participantId);
  if (!own) throw Error('MISSING_BOT_SELF');
  const positions = resolvePositions(
      o.players.map((p) => p.seatId),
      o.dealerSeatId,
    ),
    order = (o.phase === 'preflop' ? positions.preflopOrder : positions.postflopOrder).filter((s) =>
      o.players.some((p) => p.seatId === s && !p.folded && !p.allIn && p.stack > 0),
    ),
    late = order.at(-1) === o.seatId;
  const score =
      (preflopBaseScore ?? preflopStrength(o.holeCards)) +
      (late ? BASIC_POLICY.lateBonus : 0) -
      (o.players.length === 4 ? BASIC_POLICY.fourSeatPenalty : 0),
    category = o.phase === 'preflop' ? null : evaluateBest([...o.holeCards, ...o.board]).category;
  const strong = category === null ? score >= BASIC_POLICY.strongScore : category >= 2,
    medium = category === null ? score >= BASIC_POLICY.mediumScore : category >= 1,
    cost = Math.min(o.legalActions.callAmount, own.stack),
    costRatio = o.potTotal + cost === 0 ? 0 : cost / (o.potTotal + cost),
    limit = strong
      ? BASIC_POLICY.strongCost
      : medium
        ? BASIC_POLICY.mediumCost
        : BASIC_POLICY.weakCost;
  return { score, category, strong, medium, cost, costRatio, limit };
}
export function chooseBasicAction(
  o: BotObservation,
  random: PolicyRandom,
  preflopBaseScore?: number,
): Action | null {
  const fallback = () => adaptBotIntent(null, o.legalActions);
  try {
    const a = assessBasic(o, preflopBaseScore),
      legal = o.legalActions,
      draw = () => {
        const n = random.next();
        if (!Number.isFinite(n) || n < 0 || n >= 1) throw Error('INVALID_POLICY_RANDOM');
        return n;
      },
      raiseType = legal.allowed.includes('bet')
        ? 'bet'
        : legal.allowed.includes('raise')
          ? 'raise'
          : null;
    if (legal.allowed.includes('check')) {
      if (a.strong && raiseType && draw() < BASIC_POLICY.freeBetProbability)
        return adaptBotIntent({ type: raiseType, raiseTo: legal.minRaiseTo }, legal);
      return { type: 'check' };
    }
    if (a.costRatio > a.limit) return fallback();
    if (a.strong && raiseType && draw() < BASIC_POLICY.paidRaiseProbability)
      return adaptBotIntent({ type: raiseType, raiseTo: legal.minRaiseTo }, legal);
    if (legal.allowed.includes('call')) return { type: 'call' };
    if (legal.allowed.includes('allIn') && legal.allIn?.kind === 'call') return { type: 'allIn' };
    return fallback();
  } catch {
    return fallback();
  }
}
