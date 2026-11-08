import type { CardId } from '@orbit/protocol';
import { parseCard } from '@orbit/poker-core';
export function preflopStrength(cards: readonly [CardId, CardId]): number {
  if (cards.length !== 2 || cards[0] === cards[1]) throw Error('INVALID_HOLE_CARDS');
  const a = parseCard(cards[0]),
    b = parseCard(cards[1]),
    gap = Math.abs(a.value - b.value);
  return Math.max(
    0,
    Math.min(
      100,
      2 * (Math.max(a.value, b.value) - 2) +
        (a.value === b.value ? 35 : 0) +
        (a.suit === b.suit ? 6 : 0) +
        (gap <= 1 ? 6 : gap >= 4 ? -4 : 0),
    ),
  );
}
