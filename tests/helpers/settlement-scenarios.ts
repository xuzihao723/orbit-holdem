import { scenario, record, array, integer, seat, text, cards } from './fixture-read.js';
import type { Contribution } from '../../packages/poker-core/src/pots.js';
import type { RankedSeat, ShowdownSeat } from '../../packages/poker-core/src/settlement-types.js';
import type { HandCategory } from '../../packages/poker-core/src/evaluate.js';
export function loadSettlementFixture(id: string) {
  if (!/^P0[1-7]$/.test(id)) throw new Error('INVALID_SETTLEMENT_FIXTURE');
  const source = scenario(id, ['buildAndAwardPots']),
    g = source.given,
    e = source.expected,
    ids = record(g.seatIds),
    folded = array(g.foldedPlayerIds).map(text);
  const map = (value: unknown) => {
    const key = text(value);
    if (!Object.hasOwn(ids, key)) throw new Error('UNKNOWN_FIXTURE_PLAYER');
    return seat(ids[key]);
  };
  const contributions: Contribution[] = Object.entries(record(g.contributions)).map(([id, v]) => ({
    seatId: map(id),
    amount: integer(v),
    folded: folded.includes(id),
  }));
  const ranks: RankedSeat[] = Object.entries(record(g.handRanks))
    .filter(([id]) => Object.hasOwn(record(g.contributions), id))
    .map(([id, value]) => {
      const numbers = array(value).map(integer),
        category = numbers[0];
      if (category === undefined || category > 8) throw new Error('INVALID_FIXTURE_RANK');
      return {
        seatId: map(id),
        rank: { category: category as HandCategory, tieBreak: numbers.slice(1) },
      };
    });
  const showdownSeats: ShowdownSeat[] =
    g.settlementHoleCards === undefined
      ? []
      : Object.entries(record(g.settlementHoleCards)).map(([id, value]) => {
          const c = cards(value);
          if (c.length !== 2) throw new Error('INVALID_FIXTURE_HOLE');
          return { seatId: map(id), holeCards: [c[0]!, c[1]!] };
        });
  return {
    contributions,
    ranks,
    dealerSeatId: seat(g.dealerSeatId),
    board: g.settlementBoard === undefined ? null : cards(g.settlementBoard),
    showdownSeats,
    reason:
      contributions.filter((p) => !p.folded).length === 1
        ? ('allOthersFolded' as const)
        : ('showdown' as const),
    expected: {
      refunds: Object.entries(record(e.refunds)).map(([id, v]) => ({
        seatId: map(id),
        amount: integer(v),
      })),
      pots: array(e.pots).map((value) => {
        const p = record(value);
        return {
          amount: integer(p.amount),
          eligibleSeatIds: array(p.eligiblePlayerIds).map(map),
          winnerSeatIds: array(p.winnerPlayerIds).map(map),
        };
      }),
      payouts: Object.entries(record(e.payouts)).map(([id, v]) => ({
        seatId: map(id),
        amount: integer(v),
      })),
      payoutTotal: integer(e.payoutTotal),
      refundTotal: integer(e.refundTotal),
      originalContributionTotal: integer(e.originalContributionTotal),
      oddChipRecipientSeatIds:
        e.oddChipRecipientPlayerIds === undefined
          ? null
          : array(e.oddChipRecipientPlayerIds).map(map),
    },
  };
}
