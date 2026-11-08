import { expect, it } from 'vitest';
import { classifyPreflop, PREFLOP_TABLE } from '../../apps/server/src/bots/preflop-table.js';
import { createDeck } from '../../packages/poker-core/src/index.js';
it('classifies all 1326 distinct pairs into all 169 symmetric classes', () => {
  const deck = createDeck(),
    seen = new Set<string>();
  let count = 0;
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++) {
      const key = classifyPreflop([deck[i]!, deck[j]!]);
      expect(classifyPreflop([deck[j]!, deck[i]!])).toBe(key);
      expect(PREFLOP_TABLE[key]).toBeTruthy();
      seen.add(key);
      count++;
    }
  expect(count).toBe(1326);
  expect(seen.size).toBe(169);
  expect(Object.keys(PREFLOP_TABLE).sort()).toEqual([...seen].sort());
});
it('distinguishes pairs, suited and offsuit classes and rejects duplicate cards', () => {
  expect(classifyPreflop(['AS', 'KS'])).toBe('AKs');
  expect(classifyPreflop(['KS', 'AH'])).toBe('AKo');
  expect(classifyPreflop(['10S', '10H'])).toBe('TT');
  expect(PREFLOP_TABLE.AAs).toBeUndefined();
  expect(PREFLOP_TABLE.AA!.tier).toBe('strong');
  expect(PREFLOP_TABLE['22']!.tier).toBe('medium');
  expect(PREFLOP_TABLE.AKs!.score).toBeGreaterThan(PREFLOP_TABLE.AKo!.score);
  expect(Object.isFrozen(PREFLOP_TABLE.AA)).toBe(true);
  expect(() => classifyPreflop(['AS', 'AS'])).toThrow();
});
