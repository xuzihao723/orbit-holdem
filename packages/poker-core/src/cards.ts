export const SUITS = Object.freeze(['S', 'H', 'C', 'D'] as const);
export const RANKS = Object.freeze([
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
] as const);
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type CardId = `${Rank}${Suit}`;
export interface ParsedCard {
  readonly id: CardId;
  readonly suit: Suit;
  readonly rank: Rank;
  readonly value: number;
}

export function createDeck(): CardId[] {
  const deck: CardId[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(`${rank}${suit}`);
  return deck;
}

const validIds: ReadonlySet<string> = new Set(createDeck());

export function isCardId(value: unknown): value is CardId {
  return typeof value === 'string' && validIds.has(value);
}

export function parseCard(value: unknown): ParsedCard {
  if (!isCardId(value)) throw new TypeError('INVALID_CARD');
  const suit = SUITS.find((candidate) => value.endsWith(candidate));
  const rank = RANKS.find((candidate) => value.slice(0, -1) === candidate);
  if (suit === undefined || rank === undefined) throw new TypeError('INVALID_CARD');
  return Object.freeze({ id: value, suit, rank, value: RANKS.indexOf(rank) + 2 });
}
