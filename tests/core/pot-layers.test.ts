import { expect, it } from 'vitest';
import { buildPotLayers } from '../../packages/poker-core/src/pots.js';
import type { Contribution } from '../../packages/poker-core/src/pots.js';
import { loadPotFixture } from '../helpers/pot-scenarios.js';

for (const id of ['P01', 'P02', 'P03', 'P04', 'P06', 'P07'])
  it(id + ' verifies only original refund, pot-layer and eligibility assertions', () => {
    const { contributions, expected, sourceOperation } = loadPotFixture(id),
      before = structuredClone(contributions);
    expect(sourceOperation).toBe('buildAndAwardPots');
    contributions.forEach(Object.freeze);
    Object.freeze(contributions);
    const r = buildPotLayers(contributions);
    expect(contributions).toEqual(before);
    expect(r.originalContributionTotal).toBe(expected.originalContributionTotal);
    expect(r.potTotal).toBe(expected.potTotal);
    expect(r.refundTotal).toBe(expected.refundTotal);
    expect(r.refunds).toEqual(expected.refunds);
    expect(r.pots.map((p) => ({ amount: p.amount, eligibleSeatIds: p.eligibleSeatIds }))).toEqual(
      expected.pots,
    );
    expect(r.refundTotal + r.potTotal).toBe(r.originalContributionTotal);
    expect(r.adjustedContributions.reduce((s, p) => s + p.amount, 0)).toBe(r.potTotal);
    let lower = 0;
    for (const p of r.pots) {
      expect(p.lowerExclusive).toBe(lower);
      expect(p.upperInclusive).toBeGreaterThan(lower);
      expect(p.amount).toBe((p.upperInclusive - lower) * p.contributorSeatIds.length);
      expect(p.potId).toBe(`pot:${lower}:${p.upperInclusive}`);
      expect(p.contributorSeatIds).toEqual(
        r.adjustedContributions.filter((c) => c.amount >= p.upperInclusive).map((c) => c.seatId),
      );
      lower = p.upperInclusive;
    }
    expect(buildPotLayers([...contributions].reverse())).toEqual(r);
    expect(Object.isFrozen(r)).toBe(true);
    for (const list of [r.adjustedContributions, r.refunds, r.pots]) {
      expect(Object.isFrozen(list)).toBe(true);
      expect(list.every(Object.isFrozen)).toBe(true);
    }
    for (const p of r.pots) {
      expect(Object.isFrozen(p.contributorSeatIds)).toBe(true);
      expect(Object.isFrozen(p.eligibleSeatIds)).toBe(true);
    }
    expect('payouts' in r).toBe(false);
    expect(r.pots.every((p) => !('winnerSeatIds' in p))).toBe(true);
  });
it('P02 keeps folded money in every reached layer, including a single eligible upper layer', () => {
  const r = buildPotLayers(loadPotFixture('P02').contributions);
  expect(r.pots.map((p) => p.amount)).toEqual([400, 450, 300]);
  expect(r.pots.map((p) => p.eligibleSeatIds)).toEqual([[0, 1, 2], [1, 2], [2]]);
  expect(r.pots[2]?.contributorSeatIds).toEqual([2, 3]);
  expect(r.refunds).toEqual([]);
});
it('does not refund a tied top contribution even when one of those players folded', () => {
  const r = buildPotLayers([
    { seatId: 0, amount: 100, folded: false },
    { seatId: 3, amount: 100, folded: true },
  ]);
  expect(r.refunds).toEqual([]);
  expect(r.pots[0]?.amount).toBe(200);
  expect(r.pots[0]?.eligibleSeatIds).toEqual([0]);
});
it('returns a lone positive contribution in full and creates no zero layers', () => {
  for (const folded of [false, true]) {
    const r = buildPotLayers([
      { seatId: 3, amount: 120, folded },
      { seatId: 1, amount: 0, folded: false },
    ]);
    expect(r.refunds).toEqual([{ seatId: 3, amount: 120 }]);
    expect(r.potTotal).toBe(0);
    expect(r.pots).toEqual([]);
    expect(r.originalContributionTotal).toBe(120);
  }
  expect(buildPotLayers([])).toEqual({
    originalContributionTotal: 0,
    adjustedContributions: [],
    refunds: [],
    refundTotal: 0,
    pots: [],
    potTotal: 0,
  });
});
it('keeps stable IDs, boundaries and sparse seats under all input permutations', () => {
  const input: Contribution[] = [
    { seatId: 0, amount: 20, folded: false },
    { seatId: 2, amount: 50, folded: false },
    { seatId: 3, amount: 90, folded: true },
  ];
  const expected = buildPotLayers(input);
  for (const permutation of [
    input,
    [input[0]!, input[2]!, input[1]!],
    [input[1]!, input[0]!, input[2]!],
    [input[1]!, input[2]!, input[0]!],
    [input[2]!, input[0]!, input[1]!],
    [input[2]!, input[1]!, input[0]!],
  ])
    expect(buildPotLayers(permutation)).toEqual(expected);
  expect(expected.refunds).toEqual([{ seatId: 3, amount: 40 }]);
  expect(expected.pots.map((p) => p.potId)).toEqual(['pot:0:20', 'pot:20:50']);
});
it.each([-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '10', null, undefined])(
  'rejects invalid amount %s without mutating inputs',
  (amount) => {
    const input = [{ seatId: 0 as const, amount, folded: false }],
      before = structuredClone(input);
    // @ts-expect-error Deliberately exercising the runtime boundary with an unknown amount.
    expect(() => buildPotLayers(input)).toThrow('INVALID_CONTRIBUTION_AMOUNT');
    expect(input).toEqual(before);
  },
);
it('rejects unsafe contribution totals, duplicate seats and sparse input arrays', () => {
  expect(() =>
    buildPotLayers([
      { seatId: 0, amount: Number.MAX_SAFE_INTEGER, folded: false },
      { seatId: 1, amount: 1, folded: false },
    ]),
  ).toThrow('UNSAFE_CONTRIBUTION_TOTAL');
  expect(() =>
    buildPotLayers([
      { seatId: 2, amount: 1, folded: false },
      { seatId: 2, amount: 2, folded: false },
    ]),
  ).toThrow('INVALID_CONTRIBUTION_SEATS');
  expect(() => buildPotLayers(new Array<Contribution>(2))).toThrow('INVALID_CONTRIBUTION_SEATS');
  // @ts-expect-error Logical seats are restricted to 0..3 at compile time and runtime.
  expect(() => buildPotLayers([{ seatId: 4, amount: 1, folded: false }])).toThrow(
    'INVALID_CONTRIBUTION_SEATS',
  );
});
it('rejects a positive matched layer with no eligible player instead of losing money', () => {
  const input: Contribution[] = [
      { seatId: 0, amount: 50, folded: true },
      { seatId: 1, amount: 100, folded: true },
      { seatId: 2, amount: 100, folded: true },
    ],
    before = structuredClone(input);
  expect(() => buildPotLayers(input)).toThrow('NO_ELIGIBLE_PLAYER');
  expect(input).toEqual(before);
  const upper: Contribution[] = [
    { seatId: 0, amount: 10, folded: false },
    { seatId: 1, amount: 100, folded: true },
    { seatId: 2, amount: 100, folded: true },
  ];
  expect(() => buildPotLayers(upper)).toThrow('NO_ELIGIBLE_PLAYER');
});
it('handles safe integer endpoints without rounding', () => {
  const amount = Math.floor(Number.MAX_SAFE_INTEGER / 2),
    r = buildPotLayers([
      { seatId: 0, amount, folded: false },
      { seatId: 1, amount, folded: false },
    ]);
  expect(r.potTotal).toBe(amount * 2);
  expect(Number.isSafeInteger(r.potTotal)).toBe(true);
});
it('rejects malformed collections and nonboolean folded fields', () => {
  // @ts-expect-error The runtime boundary must reject a noncollection.
  expect(() => buildPotLayers(null)).toThrow('INVALID_CONTRIBUTION_SEATS');
  // @ts-expect-error Folded is a strict boolean rather than a truthy flag.
  expect(() => buildPotLayers([{ seatId: 0, amount: 1, folded: 'false' }])).toThrow(
    'INVALID_CONTRIBUTION_AMOUNT',
  );
});
