import { scenario, record, array, integer, seat, text } from './fixture-read.js';
import type { Contribution } from '../../packages/poker-core/src/pots.js';
export function loadPotFixture(id: string) {
  if (!['P01', 'P02', 'P03', 'P04', 'P06', 'P07'].includes(id))
    throw new Error('OUTSIDE_W10_POT_SCOPE');
  const source = scenario(id, ['buildAndAwardPots']),
    ids = record(source.given.seatIds),
    amounts = record(source.given.contributions),
    folded = array(source.given.foldedPlayerIds).map(text);
  const map = (id: unknown) => {
    const key = text(id);
    if (!Object.hasOwn(ids, key)) throw new Error('UNKNOWN_FIXTURE_PLAYER');
    return seat(ids[key]);
  };
  const contributions: Contribution[] = Object.entries(amounts).map(([id, amount]) => ({
    seatId: map(id),
    amount: integer(amount),
    folded: folded.includes(id),
  }));
  const expected = {
    originalContributionTotal: integer(source.expected.originalContributionTotal),
    potTotal: integer(source.expected.potTotal),
    refundTotal: integer(source.expected.refundTotal),
    refunds: Object.entries(record(source.expected.refunds))
      .map(([id, amount]) => ({ seatId: map(id), amount: integer(amount) }))
      .sort((a, b) => a.seatId - b.seatId),
    pots: array(source.expected.pots).map((value) => {
      const p = record(value);
      return {
        amount: integer(p.amount),
        eligibleSeatIds: array(p.eligiblePlayerIds)
          .map(map)
          .sort((a, b) => a - b),
      };
    }),
  };
  return {
    contributions,
    expected,
    sourceOperation: source.when.operation,
    scope: 'refunds/amounts/eligibility only; winners and payouts deferred to W11',
  };
}
