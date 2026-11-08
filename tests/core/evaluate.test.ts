import { expect, it } from 'vitest';
import {
  evaluateBest,
  evaluateFive,
  compareHandRanks,
} from '../../packages/poker-core/src/evaluate.js';
import { createDeck } from '../../packages/poker-core/src/index.js';
import { loadEvaluationScenarios } from '../helpers/evaluation-scenarios.js';
const data = loadEvaluationScenarios();
for (const sample of data.singles)
  it(sample.id + ' matches the frozen rank', () => {
    const before = [...sample.cards],
      r = evaluateBest(Object.freeze(sample.cards));
    expect(r.category).toBe(sample.category);
    expect(r.tieBreak).toEqual(sample.tieBreak);
    if (sample.bestFiveSet) expect([...r.bestFive].sort()).toEqual([...sample.bestFiveSet].sort());
    expect(sample.cards).toEqual(before);
    expect(r.bestFive).toHaveLength(5);
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.bestFive)).toBe(true);
    expect(Object.isFrozen(r.tieBreak)).toBe(true);
  });
it('E05 the board alone ties both players without suit tiebreaking', () => {
  const [a, b] = data.shared.hands.map(evaluateBest);
  if (!a || !b) throw new Error('Missing pair');
  expect(a.category).toBe(data.shared.category);
  expect(a.tieBreak).toEqual(data.shared.tieBreak);
  expect(compareHandRanks(a, b)).toBe(0);
  expect([...a.bestFive].sort()).toEqual([...data.shared.bestFiveSet].sort());
});
it('E06 compares every kicker with the frozen vectors', () => {
  const result = data.kickers.hands.map(evaluateBest);
  result.forEach((r, i) => expect([r.category, ...r.tieBreak]).toEqual(data.kickers.ranks[i]));
  expect(compareHandRanks(result[0]!, result[1]!)).toBe(1);
  expect(compareHandRanks(result[1]!, result[0]!)).toBe(-1);
  expect(data.kickers.winner).toEqual([0]);
});
it('E07 rejects every invalid frozen input', () => {
  expect(data.invalid.inputs).toHaveLength(data.invalid.count);
  data.invalid.inputs.forEach((input, i) =>
    expect(() => evaluateBest(input)).toThrow(data.invalid.reasons[i]),
  );
});
it('covers all nine categories including pair and straight flush', () => {
  expect(
    [...new Set([...data.singles.map((s) => s.category), data.kickers.ranks[0]?.[0]])].sort(),
  ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
it('uses the strongest five of six or seven suited cards', () => {
  expect(evaluateBest(['AS', 'KS', '9S', '7S', '5S', '3S', '2S']).tieBreak).toEqual([
    14, 13, 9, 7, 5,
  ]);
  expect(evaluateBest(['AS', 'KS', '9S', '7S', '5S', '3S']).tieBreak).toEqual([14, 13, 9, 7, 5]);
});
it('chooses the two largest pairs among three pairs', () => {
  expect(evaluateBest(['AS', 'AH', 'KS', 'KH', 'QS', 'QH', '2C']).tieBreak).toEqual([14, 13, 12]);
});
it('keeps six-high straight above a wheel', () => {
  expect(
    compareHandRanks(
      evaluateFive(['2S', '3H', '4D', '5C', '6S']),
      evaluateFive(['AS', '2H', '3D', '4C', '5S']),
    ),
  ).toBe(1);
});
it('stabilizes equivalent best five by canonical card order independently of input order', () => {
  const input = ['AS', 'AH', 'KS', 'KH', 'QS', 'QH', '2C'] as const;
  const r = evaluateBest(input);
  expect(evaluateBest([...input].reverse())).toEqual(r);
  expect(evaluateBest([...input.slice(2), ...input.slice(0, 2)])).toEqual(r);
  const order = new Map(createDeck().map((card, i) => [card, i]));
  expect(r.bestFive).toEqual([...r.bestFive].sort((a, b) => order.get(a)! - order.get(b)!));
});
it('rejects malformed vectors and strict card identifiers', () => {
  expect(() =>
    compareHandRanks({ category: 4, tieBreak: [14, 2] }, { category: 4, tieBreak: [5] }),
  ).toThrow('INVALID_HAND_RANK');
  expect(() =>
    compareHandRanks({ category: 4, tieBreak: [NaN] }, { category: 4, tieBreak: [5] }),
  ).toThrow('INVALID_HAND_RANK');
  expect(() =>
    compareHandRanks({ category: 4, tieBreak: [4] }, { category: 4, tieBreak: [5] }),
  ).toThrow('INVALID_HAND_RANK');
  // @ts-expect-error Exercise runtime invalid category.
  const invalidCategory: HandRank = { category: 9, tieBreak: [14] };
  expect(() => compareHandRanks(invalidCategory, { category: 4, tieBreak: [5] })).toThrow(
    'INVALID_HAND_RANK',
  );
  // @ts-expect-error Strict runtime card validation is still required.
  expect(() => evaluateBest(['TS', '2H', '3D', '4C', '5S'])).toThrow('INVALID_CARD');
  expect(() => evaluateFive(createDeck().slice(0, 6))).toThrow('INVALID_CARD_COUNT');
});

it('rejects sparse rank vectors instead of comparing missing numbers', () => {
  expect(() =>
    compareHandRanks(
      { category: 4, tieBreak: new Array<number>(1) },
      { category: 4, tieBreak: [5] },
    ),
  ).toThrow('INVALID_HAND_RANK');
});
