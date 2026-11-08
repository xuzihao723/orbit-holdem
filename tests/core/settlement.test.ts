import { expect, it } from 'vitest';
import {
  awardContributions,
  settleBalances,
  rankShowdown,
} from '../../packages/poker-core/src/settlement.js';
import type {
  RankedSeat,
  SettlementBalance,
} from '../../packages/poker-core/src/settlement-types.js';
import { loadSettlementFixture } from '../helpers/settlement-scenarios.js';

for (const id of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07'])
  it(id + ' executes original complete pot awards and refunds', () => {
    const data = loadSettlementFixture(id),
      before = structuredClone(data),
      r = awardContributions(data),
      e = data.expected;
    expect(r.refunds).toEqual(e.refunds);
    expect(r.refundTotal).toBe(e.refundTotal);
    expect(r.payoutTotal).toBe(e.payoutTotal);
    expect(r.originalContributionTotal).toBe(e.originalContributionTotal);
    expect(
      r.pots.map((p) => ({
        amount: p.amount,
        eligibleSeatIds: p.eligibleSeatIds,
        winnerSeatIds: [...p.winnerSeatIds].sort(),
      })),
    ).toEqual(e.pots);
    expect(
      e.payouts.map((p) => ({
        seatId: p.seatId,
        amount: r.pots
          .flatMap((pot) => pot.allocations)
          .filter((a) => a.seatId === p.seatId)
          .reduce((s, a) => s + a.amount, 0),
      })),
    ).toEqual(e.payouts);
    for (const pot of r.pots) {
      expect(pot.allocations.reduce((s, a) => s + a.amount, 0)).toBe(pot.amount);
      expect(pot.winnerSeatIds.every((s) => pot.eligibleSeatIds.includes(s))).toBe(true);
      expect(Object.isFrozen(pot.allocations)).toBe(true);
      expect(pot.allocations.every(Object.isFrozen)).toBe(true);
    }
    if (e.oddChipRecipientSeatIds)
      expect(
        r.pots.flatMap((p) =>
          p.allocations
            .filter((a) => a.amount > Math.floor(p.amount / p.winnerSeatIds.length))
            .map((a) => a.seatId),
        ),
      ).toEqual(e.oddChipRecipientSeatIds);
    expect(
      awardContributions({
        ...data,
        contributions: [...data.contributions].reverse(),
        ranks: [...data.ranks].reverse(),
      }),
    ).toEqual(r);
    expect(data).toEqual(before);
    expect(Object.isFrozen(r)).toBe(true);
    if (data.board) {
      const actual = rankShowdown(data.board, data.showdownSeats);
      expect(actual).toEqual(data.ranks);
      expect(awardContributions({ ...data, ranks: actual })).toEqual(r);
    }
  });
it('P03 transfers only 300/300 awards and the separate 150 refund then clears commitments', () => {
  const d = loadSettlementFixture('P03'),
    players: SettlementBalance[] = d.contributions.map((p) => ({
      ...p,
      stack: 1000 - p.amount,
      streetCommitted: p.amount,
    })),
    before = structuredClone(players),
    r = settleBalances({ ...d, players });
  expect(r.finalBalances.map((p) => p.stack)).toEqual([1200, 1050, 750]);
  expect(r.finalBalances.every((p) => p.streetCommitted === 0 && p.handCommitted === 0)).toBe(true);
  expect(players).toEqual(before);
  expect(r.finalBalances.every(Object.isFrozen)).toBe(true);
  const second = settleBalances({
    ...d,
    players: r.finalBalances.map((p) => ({ ...p, amount: 0, folded: false })),
  });
  expect(second.plan.payoutTotal).toBe(0);
  expect(second.plan.refundTotal).toBe(0);
  expect(second.finalBalances).toEqual(r.finalBalances);
});
it('P06 refunds a folded contributor without calling its refund a pot award', () => {
  const d = loadSettlementFixture('P06'),
    r = settleBalances({
      ...d,
      players: d.contributions.map((p) => ({
        ...p,
        stack: 1000 - p.amount,
        streetCommitted: p.amount,
      })),
      ranks: [],
    });
  expect(r.finalBalances.map((p) => p.stack)).toEqual([1100, 900]);
  expect(r.plan.pots[0]?.winningCategory).toBeNull();
  expect(r.plan.pots[0]?.winnerSeatIds).toEqual([0]);
});
it('splits two odd pots separately and gives a tied dealer the last clockwise priority', () => {
  const ranks: RankedSeat[] = [0, 1, 2, 3].map((seatId) => ({
    seatId: seatId as 0 | 1 | 2 | 3,
    rank: { category: 4, tieBreak: [9] },
  }));
  const r = awardContributions({
    dealerSeatId: 2,
    reason: 'showdown',
    ranks,
    contributions: [
      { seatId: 0, amount: 1, folded: false },
      { seatId: 1, amount: 2, folded: false },
      { seatId: 2, amount: 2, folded: false },
      { seatId: 3, amount: 2, folded: true },
    ],
  });
  expect(r.pots.map((p) => p.amount)).toEqual([4, 3]);
  expect(r.pots.map((p) => p.allocations)).toEqual([
    [
      { seatId: 0, amount: 2 },
      { seatId: 1, amount: 1 },
      { seatId: 2, amount: 1 },
    ],
    [
      { seatId: 1, amount: 2 },
      { seatId: 2, amount: 1 },
    ],
  ]);
  const sparse = awardContributions({
    dealerSeatId: 0,
    reason: 'showdown',
    ranks: [ranks[0]!, ranks[3]!],
    contributions: [
      { seatId: 0, amount: 1, folded: false },
      { seatId: 3, amount: 1, folded: false },
    ],
  });
  expect(sparse.pots[0]?.winnerSeatIds).toEqual([3, 0]);
});
it('ranks a real public straight as equal while preserving cross-seat card uniqueness', () => {
  const ranks = rankShowdown(
    ['5S', '6H', '7D', '8C', '9S'],
    [
      { seatId: 0, holeCards: ['AS', '2H'] },
      { seatId: 1, holeCards: ['KD', '3C'] },
    ],
  );
  expect(ranks.map((p) => p.rank)).toEqual([
    { category: 4, tieBreak: [9] },
    { category: 4, tieBreak: [9] },
  ]);
  expect(() =>
    rankShowdown(
      ['5S', '6H', '7D', '8C', '9S'],
      [
        { seatId: 0, holeCards: ['AS', '2H'] },
        { seatId: 1, holeCards: ['AS', '3C'] },
      ],
    ),
  ).toThrow('INVALID_SETTLEMENT_INPUT');
  expect(() => rankShowdown(['5S'], [])).toThrow('INVALID_SETTLEMENT_INPUT');
});
it('rejects missing, duplicate, unknown and malformed rank inputs before producing awards', () => {
  const d = loadSettlementFixture('P01');
  for (const ranks of [
    [],
    [...d.ranks, d.ranks[0]!],
    d.ranks.slice(1),
    [{ seatId: 0 as const, rank: { category: 4 as const, tieBreak: [NaN] } }],
  ])
    expect(() => awardContributions({ ...d, ranks })).toThrow('INVALID_SETTLEMENT_INPUT');
  const three = loadSettlementFixture('P03');
  expect(() =>
    awardContributions({
      ...three,
      ranks: [...three.ranks, { seatId: 3, rank: { category: 4, tieBreak: [9] } }],
    }),
  ).toThrow('INVALID_SETTLEMENT_INPUT');
  expect(() => awardContributions({ ...d, reason: 'allOthersFolded' })).toThrow(
    'INVALID_SETTLEMENT_INPUT',
  );
});
it('rejects unsafe aggregate balances and invalid street amounts atomically', () => {
  const d = loadSettlementFixture('P03');
  const base = d.contributions.map((p) => ({
    ...p,
    stack: 1000 - p.amount,
    streetCommitted: p.amount,
  }));
  for (const players of [
    base.map((p) => ({ ...p, stack: -1 })),
    base.map((p) => ({ ...p, stack: NaN })),
    base.map((p) => ({ ...p, streetCommitted: p.amount + 1 })),
  ]) {
    const copy = structuredClone(players);
    expect(() => settleBalances({ ...d, players })).toThrow('INVALID_SETTLEMENT_INPUT');
    expect(players).toEqual(copy);
  }
  expect(() =>
    settleBalances({ ...d, players: base.map((p) => ({ ...p, stack: Number.MAX_SAFE_INTEGER })) }),
  ).toThrow('UNSAFE_SETTLEMENT_TOTAL');
});
