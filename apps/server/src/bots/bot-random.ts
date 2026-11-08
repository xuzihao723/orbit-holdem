import { randomInt } from 'node:crypto';
import type { PolicyRandom } from './policy-basic.js';
/** Independent draws; never share the deck shuffle seed or mutable generator. */
export function securePolicyRandom(): PolicyRandom {
  return { next: () => randomInt(0, 0x100000000) / 0x100000000 };
}
