import type { CardId } from '@orbit/protocol';
import { parseCard, RANKS } from '@orbit/poker-core';
import { preflopStrength } from './preflop-strength.js';
export function classifyPreflop(cards: readonly [CardId, CardId]): string {
  if (cards.length !== 2 || cards[0] === cards[1]) throw Error('INVALID_HOLE_CARDS');
  const [a, b] = cards.map(parseCard).sort((a, b) => b.value - a.value),
    key = (a!.rank === '10' ? 'T' : a!.rank) + (b!.rank === '10' ? 'T' : b!.rank);
  return a!.value === b!.value ? key : key + (a!.suit === b!.suit ? 's' : 'o');
}
interface Entry {
  score: number;
  tier: 'strong' | 'medium' | 'weak';
  source: string;
}
const table: Record<string, Entry> = {};
for (let hi = 0; hi < 13; hi++)
  for (let lo = 0; lo <= hi; lo++)
    for (const suited of hi === lo ? [false] : [false, true]) {
      const cards: [CardId, CardId] = [`${RANKS[hi]!}S`, `${RANKS[lo]!}${suited ? 'S' : 'H'}`],
        raw = preflopStrength(cards),
        score = Math.max(raw, hi === lo || (suited && hi >= 9 && lo >= 8) ? 45 : 0);
      table[classifyPreflop(cards)] = Object.freeze({
        score,
        tier: score >= 60 ? 'strong' : score >= 45 ? 'medium' : 'weak',
        source: 'project-heuristic-v1',
      });
    }
export const PREFLOP_TABLE: Readonly<Record<string, Entry>> = Object.freeze(table);
