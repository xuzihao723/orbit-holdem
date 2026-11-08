import { randomInt } from 'node:crypto';
import type { RandomInt } from '@orbit/poker-core';

/** Server-only production entropy; deliberately has no seed or fallback parameter. */
export const secureRandomInt: RandomInt = (minInclusive, maxExclusive) =>
  randomInt(minInclusive, maxExclusive);
