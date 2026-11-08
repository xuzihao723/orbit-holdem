import type { SeatId } from './deck.js';
export interface Contribution {
  readonly seatId: SeatId;
  readonly amount: number;
  readonly folded: boolean;
}
export interface PotRefund {
  readonly seatId: SeatId;
  readonly amount: number;
}
export interface PotLayer {
  readonly potId: string;
  readonly lowerExclusive: number;
  readonly upperInclusive: number;
  readonly amount: number;
  readonly contributorSeatIds: readonly SeatId[];
  readonly eligibleSeatIds: readonly SeatId[];
}
export interface PotBuildResult {
  readonly originalContributionTotal: number;
  readonly adjustedContributions: readonly Contribution[];
  readonly refunds: readonly PotRefund[];
  readonly refundTotal: number;
  readonly pots: readonly PotLayer[];
  readonly potTotal: number;
}
export function buildPotLayers(contributions: readonly Contribution[]): PotBuildResult {
  if (!Array.isArray(contributions) || contributions.length > 4)
    throw new RangeError('INVALID_CONTRIBUTION_SEATS');
  const ids = new Set<SeatId>();
  let originalContributionTotal = 0;
  for (const p of contributions) {
    if (!p || !Number.isInteger(p.seatId) || p.seatId < 0 || p.seatId > 3 || ids.has(p.seatId))
      throw new RangeError('INVALID_CONTRIBUTION_SEATS');
    ids.add(p.seatId);
    if (!Number.isSafeInteger(p.amount) || p.amount < 0 || typeof p.folded !== 'boolean')
      throw new RangeError('INVALID_CONTRIBUTION_AMOUNT');
    originalContributionTotal += p.amount;
    if (!Number.isSafeInteger(originalContributionTotal))
      throw new RangeError('UNSAFE_CONTRIBUTION_TOTAL');
  }
  const adjusted = contributions.map((p) => ({ ...p })).sort((a, b) => a.seatId - b.seatId);
  const byAmount = [...adjusted].sort((a, b) => b.amount - a.amount || a.seatId - b.seatId),
    refunds: PotRefund[] = [];
  const top = byAmount[0],
    second = byAmount[1]?.amount ?? 0;
  if (top && top.amount > second) {
    const amount = top.amount - second;
    refunds.push(Object.freeze({ seatId: top.seatId, amount }));
    top.amount = second;
  }
  const pots: PotLayer[] = [];
  let lower = 0;
  const heights = [...new Set(adjusted.map((p) => p.amount).filter((n) => n > 0))].sort(
    (a, b) => a - b,
  );
  for (const upper of heights) {
    const contributors = adjusted.filter((p) => p.amount >= upper),
      eligible = contributors.filter((p) => !p.folded);
    if (!eligible.length) throw new RangeError('NO_ELIGIBLE_PLAYER');
    const amount = (upper - lower) * contributors.length;
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new RangeError('UNSAFE_CONTRIBUTION_TOTAL');
    pots.push(
      Object.freeze({
        potId: `pot:${lower}:${upper}`,
        lowerExclusive: lower,
        upperInclusive: upper,
        amount,
        contributorSeatIds: Object.freeze(contributors.map((p) => p.seatId)),
        eligibleSeatIds: Object.freeze(eligible.map((p) => p.seatId)),
      }),
    );
    lower = upper;
  }
  const refundTotal = refunds.reduce((s, p) => s + p.amount, 0),
    potTotal = pots.reduce((s, p) => s + p.amount, 0);
  if (
    refundTotal + potTotal !== originalContributionTotal ||
    adjusted.reduce((s, p) => s + p.amount, 0) !== potTotal
  )
    throw new RangeError('UNSAFE_CONTRIBUTION_TOTAL');
  return Object.freeze({
    originalContributionTotal,
    adjustedContributions: Object.freeze(adjusted.map((p) => Object.freeze(p))),
    refunds: Object.freeze(refunds),
    refundTotal,
    pots: Object.freeze(pots),
    potTotal,
  });
}
