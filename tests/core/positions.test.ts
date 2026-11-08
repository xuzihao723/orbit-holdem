import { expect, it, vi } from 'vitest';
import {
  resolvePositions,
  resolveNextPositions,
  postBlinds,
  chooseFirstDealer,
  getActionOrder,
} from '../../packages/poker-core/src/positions.js';
import { getDealOrder } from '../../packages/poker-core/src/index.js';
import type { SeatId, RandomInt } from '../../packages/poker-core/src/index.js';
import { loadPositionScenarios } from '../helpers/position-scenarios.js';
const data = loadPositionScenarios();
for (const [i, v] of data.variants.entries())
  it('O01 variant ' + i + ' follows physical clockwise seats', () => {
    expect(resolvePositions(v.seats, v.dealer)).toMatchObject(v.expected);
  });
it('O02 heads-up dealer is the small blind and receives last', () => {
  expect(resolvePositions(data.two.seats, data.two.dealer)).toMatchObject(data.two.expected);
});
it('O03 prevents a surviving old big blind posting it twice on transition to heads-up', () => {
  const n = resolveNextPositions(data.three.previous, data.three.next);
  expect(n).toMatchObject(data.three.expected);
  const after = resolveNextPositions(
    {
      seatIds: data.three.next,
      dealerSeatId: n.dealerSeatId,
      bigBlindSeatId: n.bigBlindSeatId,
      continuedSeatIds: data.three.next,
    },
    data.three.next,
  );
  expect(after.dealerSeatId).toBe(0);
  expect(after.bigBlindSeatId).toBe(2);
});
it('does not confuse a new participant in an old big-blind seat with a survivor', () => {
  expect(
    resolveNextPositions(
      { seatIds: [0, 1, 2, 3], dealerSeatId: 0, bigBlindSeatId: 2, continuedSeatIds: [1] },
      [1, 2],
    ).dealerSeatId,
  ).toBe(1);
});
it('advances from an eliminated dealer across gaps and validates previous blind history', () => {
  expect(
    resolveNextPositions(
      { seatIds: [0, 1, 2, 3], dealerSeatId: 0, bigBlindSeatId: 2, continuedSeatIds: [1, 3] },
      [1, 3],
    ).dealerSeatId,
  ).toBe(1);
  expect(
    resolveNextPositions(
      { seatIds: [0, 1, 2, 3], dealerSeatId: 0, bigBlindSeatId: 2, continuedSeatIds: [0, 2, 3] },
      [0, 2, 3],
    ).dealerSeatId,
  ).toBe(2);
  expect(() =>
    resolveNextPositions(
      { seatIds: [0, 1, 2], dealerSeatId: 0, bigBlindSeatId: 1, continuedSeatIds: [0, 2] },
      [0, 2],
    ),
  ).toThrow('INVALID_PREVIOUS_POSITIONS');
  expect(() =>
    resolveNextPositions(
      { seatIds: [0, 1, 2], dealerSeatId: 0, bigBlindSeatId: 2, continuedSeatIds: [1] },
      [0, 2],
    ),
  ).toThrow('INVALID_PREVIOUS_POSITIONS');
});
it('matches W05 dealing and remains stable across all dealer choices and input permutations', () => {
  for (const list of [
    [0, 1],
    [0, 2, 3],
    [0, 1, 2, 3],
  ] as SeatId[][])
    for (const dealer of list) {
      const p = resolvePositions(list, dealer);
      expect(p.dealOrder).toEqual(getDealOrder(list, dealer));
      expect(resolvePositions([...list].reverse(), dealer)).toEqual(p);
      expect(new Set(p.preflopOrder).size).toBe(list.length);
      expect([...p.postflopOrder].sort()).toEqual([...list].sort());
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.dealOrder)).toBe(true);
    }
});
it('selects first dealer using one bounded injected draw on sorted seats', () => {
  const rng = vi.fn<RandomInt>(() => 1);
  expect(chooseFirstDealer([3, 1], rng)).toBe(3);
  expect(rng.mock.calls).toEqual([[0, 2]]);
});
it.each([-1, 2, 0.5, NaN])('rejects invalid first dealer draw %s', (value) => {
  expect(() => chooseFirstDealer([0, 2], () => value)).toThrow('INVALID_RANDOM_INDEX');
});
it.each([[], [0], [0, 0], [0, 4]].map((seats) => ({ seats })))(
  'rejects malformed positions $seats',
  ({ seats }) => {
    expect(() => resolvePositions(seats as SeatId[], 0)).toThrow('INVALID_SEATS');
  },
);
it('O04 deducts only 5/7 while retaining the nominal 20 line and unacted history', () => {
  const input = Object.freeze(data.four.players.map((p) => Object.freeze({ ...p }))),
    before = structuredClone(input);
  const p = postBlinds(input, resolvePositions(data.four.seats, data.four.dealer));
  expect(p).toEqual(data.four.expected);
  expect(input).toEqual(before);
  expect(p.players.every((p) => p.lastActedAtBet === null)).toBe(true);
  expect(Object.isFrozen(p.players)).toBe(true);
});
it('O05 posting big blind does not remove its voluntary action opportunity', () => {
  const pos = resolvePositions([0, 1, 2], 0),
    posted = postBlinds(
      [0, 1, 2].map((s) => ({ seatId: s as SeatId, stack: 2000 })),
      pos,
    );
  expect(posted.players.find((p) => p.seatId === 2)?.lastActedAtBet).toBeNull();
  expect(getActionOrder(pos, 'preflop', posted.players)).toContain(2);
});
it('filters folded/all-in/zero-stack players without renumbering seats', () => {
  const pos = resolvePositions([0, 1, 2, 3], 0),
    p = postBlinds(
      [0, 1, 2, 3].map((s) => ({ seatId: s as SeatId, stack: 2000 })),
      pos,
    ).players.map((p) =>
      p.seatId === 1
        ? { ...p, folded: true }
        : p.seatId === 2
          ? { ...p, stack: 0, allIn: true }
          : p,
    );
  expect(getActionOrder(pos, 'flop', p)).toEqual([3, 0]);
  expect(
    getActionOrder(
      pos,
      'flop',
      p.map((p) => ({ ...p, folded: true })),
    ),
  ).toEqual([]);
});
it.each([-1, 0, 0.5, NaN, Infinity])('rejects invalid stack %s atomically', (stack) => {
  const input = [
    { seatId: 0 as const, stack: 2000 },
    { seatId: 1 as const, stack },
  ];
  const before = structuredClone(input);
  expect(() => postBlinds(input, resolvePositions([0, 1], 0))).toThrow('INVALID_STACK');
  expect(input).toEqual(before);
});
it('rejects unsafe total and inconsistent current position maps', () => {
  expect(() =>
    postBlinds(
      [
        { seatId: 0, stack: Number.MAX_SAFE_INTEGER },
        { seatId: 1, stack: 1 },
      ],
      resolvePositions([0, 1], 0),
    ),
  ).toThrow('UNSAFE_CHIP_TOTAL');
  const p = resolvePositions([0, 1], 0);
  expect(() =>
    postBlinds(
      [
        { seatId: 0, stack: 20 },
        { seatId: 1, stack: 20 },
      ],
      { ...p, smallBlindSeatId: 1 },
    ),
  ).toThrow('INVALID_POSITIONS');
});
it('rejects string stacks and duplicate blind seats without partial deduction', () => {
  const positions = resolvePositions([0, 1], 0),
    malformed = [
      { seatId: 0 as const, stack: 2000 },
      { seatId: 1 as const, stack: '20' },
    ],
    before = structuredClone(malformed);
  // @ts-expect-error Runtime callers must not coerce a string chip balance.
  expect(() => postBlinds(malformed, positions)).toThrow('INVALID_STACK');
  expect(malformed).toEqual(before);
  expect(() =>
    postBlinds(
      [
        { seatId: 0, stack: 20 },
        { seatId: 0, stack: 20 },
      ],
      positions,
    ),
  ).toThrow('INVALID_SEATS');
});
