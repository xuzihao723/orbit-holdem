import { writeFileSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createDeck, shuffleDeck } from '../../packages/poker-core/src/index.js';
import {
  evaluateBest,
  compareHandRanks,
  type EvaluatedHand,
} from '../../packages/poker-core/src/evaluate.js';
import { oracleSolve, oracleCompare } from '../helpers/pokersolver-oracle.js';
import { createTestRandom } from '../helpers/test-random.js';
import { loadEvaluationScenarios } from '../helpers/evaluation-scenarios.js';
import { record, text } from '../helpers/fixture-read.js';
import type { Hand } from 'pokersolver';
it('calibrates nine oracle categories and winner direction on independent frozen examples', () => {
  const data = loadEvaluationScenarios();
  const categories = new Set<number>();
  for (const s of data.singles) {
    const solved = oracleSolve(s.cards);
    expect(solved.rank - 1).toBe(s.category);
    categories.add(solved.rank - 1);
  }
  const [first, second] = data.kickers.hands.map(oracleSolve);
  if (!first || !second) throw new Error('Missing comparisons');
  expect(oracleCompare(first, second)).toBe(1);
  expect(oracleCompare(second, first)).toBe(-1);
  categories.add(first.rank - 1);
  expect([...categories].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(
    oracleCompare(oracleSolve(data.shared.hands[0]!), oracleSolve(data.shared.hands[1]!)),
  ).toBe(0);
});
it('cross-validates ten thousand seeded seven-card sets and relative strengths', () => {
  const seed = 0x06002026,
    samples = 10000,
    rng = createTestRandom(seed),
    deck = createDeck();
  const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
  if (!/^(?:w\d{2}|scratch)$/.test(stage)) throw new Error('INVALID_VERIFICATION_STAGE');
  const packageInfo = record(
    JSON.parse(
      readFileSync(new URL('../../node_modules/pokersolver/package.json', import.meta.url), 'utf8'),
    ),
  );
  let previous: { ours: EvaluatedHand; oracle: Hand; cards: readonly string[] } | undefined;
  let completed = 0,
    categoryMismatches = 0,
    strengthMismatches = 0,
    orderMismatches = 0;
  const failures: unknown[] = [];
  for (let i = 0; i < samples; i++) {
    const cards = shuffleDeck(deck, rng).slice(0, 7),
      ours = evaluateBest(cards),
      oracle = oracleSolve(cards);
    const category = ours.category !== oracle.rank - 1;
    const strength = oracleCompare(oracle, oracleSolve(ours.bestFive)) !== 0;
    const ordering = previous
      ? compareHandRanks(ours, previous.ours) !== oracleCompare(oracle, previous.oracle)
      : false;
    categoryMismatches += Number(category);
    strengthMismatches += Number(strength);
    orderMismatches += Number(ordering);
    completed++;
    if (category || strength || ordering)
      failures.push({
        index: i,
        cards,
        ours,
        oracleRank: oracle.rank,
        previousCards: previous?.cards,
        category,
        strength,
        ordering,
      });
    previous = { ours, oracle, cards };
  }
  const report = {
    version: text(packageInfo.version),
    seed,
    samples,
    completed,
    categoryMismatches,
    strengthMismatches,
    orderMismatches,
    failures,
  };
  writeFileSync(`docs/verification/${stage}-oracle.json`, JSON.stringify(report, null, 2) + '\n');
  expect(completed).toBe(samples);
  expect(failures.slice(0, 3)).toEqual([]);
}, 60000);
