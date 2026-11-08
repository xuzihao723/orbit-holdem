import type { RandomInt } from '../../packages/poker-core/src/index.js';
export function createTestRandom(seed: number): RandomInt {
  let state = seed >>> 0;
  if (!state) throw new RangeError('INVALID_TEST_SEED');
  return (min, max) => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min)
      throw new RangeError('INVALID_TEST_RANGE');
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return min + ((state >>> 0) % (max - min));
  };
}
