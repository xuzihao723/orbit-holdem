import { expect, it } from 'vitest';
import { secureRandomInt } from '../../apps/server/src/game/random.js';
import { createDeck, shuffleDeck } from '../../packages/poker-core/src/index.js';
it('uses inclusive lower and exclusive upper endpoints in a real single-value range', () => {
  for (let i = 0; i < 16; i++) expect(secureRandomInt(7, 8)).toBe(7);
});
it('keeps actual cryptographic samples within the deck index range', () => {
  for (let i = 0; i < 256; i++) {
    const value = secureRandomInt(0, 52);
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(52);
  }
});
it.each([
  { min: 0, max: 0 },
  { min: 2, max: 1 },
  { min: 0.5, max: 2 },
  { min: 0, max: 2.5 },
  { min: NaN, max: 52 },
  { min: 0, max: NaN },
  { min: 0, max: Infinity },
  { min: -Infinity, max: 52 },
])('propagates invalid cryptographic range $min..$max', ({ min, max }) => {
  expect(() => secureRandomInt(min, max)).toThrow();
});
it('combines the real server adapter with the pure shuffle without changing the source', () => {
  const input = Object.freeze(createDeck());
  const shuffled = shuffleDeck(input, secureRandomInt);
  expect(shuffled).toHaveLength(52);
  expect(new Set(shuffled).size).toBe(52);
  expect([...shuffled].sort()).toEqual([...input].sort());
  expect(input).toEqual(createDeck());
});
