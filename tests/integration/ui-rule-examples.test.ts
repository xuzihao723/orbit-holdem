import { expect, it } from 'vitest';
import { evaluateFive } from '@orbit/poker-core';
import {
  HAND_RANK_EXAMPLES,
  additionalRaiseCost,
} from '../../apps/web/src/features/rules/hand-rank-examples.js';
it('verifies nine real five-card examples and amount semantics', () => {
  expect(HAND_RANK_EXAMPLES).toHaveLength(9);
  for (const [i, e] of HAND_RANK_EXAMPLES.entries())
    expect(evaluateFive(e.cards).category).toBe(8 - i);
  expect(additionalRaiseCost(100, 20)).toBe(80);
});
