import type { BotObservation, UnknownSample, EquityEstimate, SampleControl } from './bot-types.js';
import type { PolicyRandom } from './policy-basic.js';
import { rankShowdown, awardContributions } from '@orbit/poker-core';
import { validateEquityObservation, sampleFromPool } from './sampling.js';
function settle(o: BotObservation, s: UnknownSample, cost: number) {
  const opponents = o.players.filter((p) => !p.folded && p.participantId !== o.participantId);
  if (
    s.board.length !== 5 ||
    o.board.some((card, i) => s.board[i] !== card) ||
    s.opponents.length !== opponents.length ||
    new Set(s.opponents.map((p) => p.seatId)).size !== opponents.length ||
    s.opponents.some((p) => !opponents.some((q) => q.seatId === p.seatId))
  )
    throw Error('INVALID_EQUITY_SAMPLE');
  const contributions = o.players.map((p) => ({
      seatId: p.seatId,
      amount: p.handCommitted + (p.participantId === o.participantId ? cost : 0),
      folded: p.folded,
    })),
    ranks = rankShowdown(s.board, [{ seatId: o.seatId, holeCards: o.holeCards }, ...s.opponents]),
    plan = awardContributions({
      contributions,
      ranks,
      dealerSeatId: o.dealerSeatId,
      reason: 'showdown',
    }),
    eligible = plan.pots.filter((p) => p.eligibleSeatIds.includes(o.seatId)),
    eligibleAmount = eligible.reduce((n, p) => n + p.amount, 0),
    weighted = eligible.reduce(
      (n, p) => n + (p.winnerSeatIds.includes(o.seatId) ? p.amount / p.winnerSeatIds.length : 0),
      0,
    ),
    heroPayout = plan.pots
      .flatMap((p) => p.allocations)
      .filter((a) => a.seatId === o.seatId)
      .reduce((n, a) => n + a.amount, 0),
    refund = plan.refunds.filter((r) => r.seatId === o.seatId).reduce((n, r) => n + r.amount, 0),
    paidTotal =
      plan.pots.flatMap((p) => p.allocations).reduce((n, a) => n + a.amount, 0) + plan.refundTotal;
  if (paidTotal !== plan.originalContributionTotal) throw Error('EQUITY_CONSERVATION');
  return {
    heroReturn: heroPayout + refund,
    weightedShare: eligibleAmount === 0 ? 0 : weighted / eligibleAmount,
    contributionTotal: plan.originalContributionTotal,
    paidTotal,
  };
}
export function settleEquitySample(o: BotObservation, s: UnknownSample) {
  const { cost } = validateEquityObservation(o);
  return settle(o, s, cost);
}
export function estimateEquity(
  o: BotObservation,
  random: PolicyRandom,
  samples: number,
  control: SampleControl,
): EquityEstimate {
  if (
    !Number.isSafeInteger(samples) ||
    samples < 1 ||
    samples > 10000 ||
    typeof control?.shouldStop !== 'function'
  )
    throw Error('INVALID_EQUITY_REQUEST');
  const { pool, cost } = validateEquityObservation(o);
  let completed = 0,
    meanShare = 0,
    meanReturn = 0,
    stopReason: EquityEstimate['stopReason'] = 'completed';
  for (let i = 0; i < samples; i++) {
    const stop = control.shouldStop();
    if (typeof stop !== 'boolean') throw Error('INVALID_SAMPLE_CONTROL');
    if (stop) {
      stopReason = control.reason?.() ?? 'budget';
      break;
    }
    const value = settle(o, sampleFromPool(o, pool, random), cost);
    completed++;
    meanShare += (value.weightedShare - meanShare) / completed;
    meanReturn += (value.heroReturn - meanReturn) / completed;
  }
  return {
    requestedSamples: samples,
    completedSamples: completed,
    weightedShare: Math.min(1, Math.max(0, meanShare)),
    expectedReturn: meanReturn,
    additionalCallCost: cost,
    expectedNet: meanReturn - cost,
    stopReason,
  };
}
