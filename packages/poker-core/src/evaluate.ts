import { createDeck, parseCard, type CardId, type ParsedCard } from './cards.js';
export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export interface HandRank {
  readonly category: HandCategory;
  readonly tieBreak: readonly number[];
}
export interface EvaluatedHand extends HandRank {
  readonly bestFive: readonly CardId[];
}
const canonical = new Map(createDeck().map((card, index) => [card, index]));
const lengths = [5, 4, 3, 3, 1, 5, 2, 2, 1] as const;
function validated(cards: readonly CardId[], minimum: number, maximum: number): ParsedCard[] {
  if (!Array.isArray(cards) || cards.length < minimum || cards.length > maximum)
    throw new RangeError('INVALID_CARD_COUNT');
  const result = Array.from(cards, parseCard);
  if (new Set(result.map((c) => c.id)).size !== result.length)
    throw new RangeError('DUPLICATE_CARD');
  return result;
}
function assertRank(rank: HandRank): void {
  if (
    !rank ||
    !Number.isInteger(rank.category) ||
    rank.category < 0 ||
    rank.category > 8 ||
    !Array.isArray(rank.tieBreak) ||
    rank.tieBreak.length !== lengths[rank.category] ||
    Array.from(rank.tieBreak).some((n) => !Number.isSafeInteger(n) || n < 2 || n > 14)
  )
    throw new RangeError('INVALID_HAND_RANK');
  const t = rank.tieBreak;
  if ((rank.category === 4 || rank.category === 8) && t[0]! < 5)
    throw new RangeError('INVALID_HAND_RANK');
  const descending = (values: readonly number[]) =>
    values.every((n, i) => i === 0 || values[i - 1]! > n);
  if ((rank.category === 0 || rank.category === 5) && !descending(t))
    throw new RangeError('INVALID_HAND_RANK');
  if (rank.category === 1 && (!descending(t.slice(1)) || t.slice(1).includes(t[0]!)))
    throw new RangeError('INVALID_HAND_RANK');
  if (rank.category === 2 && (t[0]! <= t[1]! || t[2] === t[0] || t[2] === t[1]))
    throw new RangeError('INVALID_HAND_RANK');
  if (rank.category === 3 && (!descending(t.slice(1)) || t.slice(1).includes(t[0]!)))
    throw new RangeError('INVALID_HAND_RANK');
  if ((rank.category === 6 || rank.category === 7) && t[0] === t[1])
    throw new RangeError('INVALID_HAND_RANK');
}
function compareKnown(a: HandRank, b: HandRank): -1 | 0 | 1 {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  for (let i = 0; i < a.tieBreak.length; i++)
    if (a.tieBreak[i] !== b.tieBreak[i]) return a.tieBreak[i]! > b.tieBreak[i]! ? 1 : -1;
  return 0;
}
export function compareHandRanks(a: HandRank, b: HandRank): -1 | 0 | 1 {
  assertRank(a);
  assertRank(b);
  return compareKnown(a, b);
}
function five(cards: readonly ParsedCard[]): EvaluatedHand {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const values = cards.map((c) => c.value).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0]?.suit);
  const wheel = values.join(',') === '14,5,4,3,2';
  const straight = counts.size === 5 && (wheel || values[0]! - values[4]! === 4);
  const high = wheel ? 5 : values[0]!;
  const main = groups[0]!;
  let category: HandCategory = 0;
  let tieBreak = values;
  if (flush && straight) {
    category = 8;
    tieBreak = [high];
  } else if (main[1] === 4) {
    category = 7;
    tieBreak = [main[0], groups[1]![0]];
  } else if (main[1] === 3 && groups[1]?.[1] === 2) {
    category = 6;
    tieBreak = [main[0], groups[1][0]];
  } else if (flush) {
    category = 5;
  } else if (straight) {
    category = 4;
    tieBreak = [high];
  } else if (main[1] === 3) {
    category = 3;
    tieBreak = [main[0], ...groups.slice(1).map((g) => g[0])];
  } else if (main[1] === 2 && groups[1]?.[1] === 2) {
    category = 2;
    tieBreak = [main[0], groups[1][0], groups[2]![0]];
  } else if (main[1] === 2) {
    category = 1;
    tieBreak = [main[0], ...groups.slice(1).map((g) => g[0])];
  }
  return Object.freeze({
    category,
    tieBreak: Object.freeze(tieBreak),
    bestFive: Object.freeze(
      cards.map((c) => c.id).sort((a, b) => canonical.get(a)! - canonical.get(b)!),
    ),
  });
}
export function evaluateFive(cards: readonly CardId[]): EvaluatedHand {
  return five(validated(cards, 5, 5));
}
function earlier(a: readonly CardId[], b: readonly CardId[]): boolean {
  for (let i = 0; i < 5; i++) {
    const difference = canonical.get(a[i]!)! - canonical.get(b[i]!)!;
    if (difference) return difference < 0;
  }
  return false;
}
export function evaluateBest(cards: readonly CardId[]): EvaluatedHand {
  const parsed = validated(cards, 5, 7);
  let best: EvaluatedHand | undefined;
  function choose(start: number, picked: ParsedCard[]): void {
    if (picked.length === 5) {
      const result = five(picked);
      const comparison = best ? compareKnown(result, best) : 1;
      if (!best || comparison > 0 || (comparison === 0 && earlier(result.bestFive, best.bestFive)))
        best = result;
      return;
    }
    for (let i = start; i <= parsed.length - (5 - picked.length); i++) {
      const card = parsed[i];
      if (card) choose(i + 1, [...picked, card]);
    }
  }
  choose(0, []);
  if (!best) throw new RangeError('INVALID_CARD_COUNT');
  return best;
}
