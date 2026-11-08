import { isCardId, type CardId } from './cards.js';

export type SeatId = 0 | 1 | 2 | 3;
export type RandomInt = (minInclusive: number, maxExclusive: number) => number;

/** Internal full deck; never serialize this state into a client view. */
export interface DeckState {
  readonly cards: readonly CardId[];
  readonly cursor: number;
}

export interface DrawResult {
  readonly cards: readonly CardId[];
  readonly deck: DeckState;
}

export type HoleCards = readonly [CardId, CardId];

/** Private dealing state, including all owners' cards and future cards. */
export interface DealtHand {
  readonly deck: DeckState;
  readonly dealOrder: readonly SeatId[];
  readonly holeCards: Readonly<Partial<Record<SeatId, HoleCards>>>;
  readonly board: readonly CardId[];
  readonly burnCards: readonly CardId[];
}

export function createDeckState(cards: readonly unknown[]): DeckState {
  if (!Array.isArray(cards) || cards.length !== 52) throw new RangeError('INVALID_DECK_SIZE');
  const validated: CardId[] = [];
  for (const card of cards) {
    if (!isCardId(card)) throw new TypeError('INVALID_CARD');
    validated.push(card);
  }
  if (new Set(validated).size !== 52) throw new RangeError('DUPLICATE_CARD');
  return Object.freeze({ cards: Object.freeze(validated), cursor: 0 });
}

function assertCursor(deck: DeckState): void {
  if (!Number.isSafeInteger(deck.cursor) || deck.cursor < 0 || deck.cursor > deck.cards.length)
    throw new RangeError('INVALID_CURSOR');
}

export function draw(deck: DeckState, count: number): DrawResult {
  assertCursor(deck);
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('INVALID_DRAW_COUNT');
  if (count > deck.cards.length - deck.cursor) throw new RangeError('DECK_EXHAUSTED');
  return Object.freeze({
    cards: Object.freeze(deck.cards.slice(deck.cursor, deck.cursor + count)),
    deck: Object.freeze({ cards: deck.cards, cursor: deck.cursor + count }),
  });
}

export function shuffleDeck(cards: readonly CardId[], randomInt: RandomInt): CardId[] {
  const shuffled = [...createDeckState(cards).cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    if (!Number.isSafeInteger(j) || j < 0 || j > i) throw new RangeError('INVALID_RANDOM_INDEX');
    const left = shuffled[i];
    const right = shuffled[j];
    if (left === undefined || right === undefined) throw new RangeError('INVALID_RANDOM_INDEX');
    shuffled[i] = right;
    shuffled[j] = left;
  }
  return shuffled;
}

export function getDealOrder(seatIds: readonly SeatId[], dealerSeatId: SeatId): readonly SeatId[] {
  if (
    !Array.isArray(seatIds) ||
    seatIds.length < 2 ||
    seatIds.length > 4 ||
    new Set(seatIds).size !== seatIds.length
  )
    throw new RangeError('INVALID_SEATS');
  for (const seat of seatIds) {
    if (seat !== 0 && seat !== 1 && seat !== 2 && seat !== 3) throw new RangeError('INVALID_SEATS');
  }
  if (!seatIds.includes(dealerSeatId)) throw new RangeError('INVALID_DEALER');
  const sorted = [...seatIds].sort(
    (a, b) => ((a - dealerSeatId + 4) % 4) - ((b - dealerSeatId + 4) % 4),
  );
  return Object.freeze([...sorted.slice(1), dealerSeatId]);
}

export function dealHoleCards(
  deck: DeckState,
  seatIds: readonly SeatId[],
  dealerSeatId: SeatId,
): DealtHand {
  const dealOrder = getDealOrder(seatIds, dealerSeatId);
  assertCursor(deck);
  if (dealOrder.length * 2 > deck.cards.length - deck.cursor)
    throw new RangeError('DECK_EXHAUSTED');
  const piles: Partial<Record<SeatId, CardId[]>> = {};
  for (const seat of dealOrder) piles[seat] = [];
  let nextDeck = deck;
  for (let round = 0; round < 2; round++) {
    for (const seat of dealOrder) {
      const dealt = draw(nextDeck, 1);
      const card = dealt.cards[0];
      const pile = piles[seat];
      if (card === undefined || pile === undefined) throw new RangeError('DECK_EXHAUSTED');
      pile.push(card);
      nextDeck = dealt.deck;
    }
  }
  const holeCards: Partial<Record<SeatId, HoleCards>> = {};
  for (const seat of dealOrder) {
    const first = piles[seat]?.[0];
    const second = piles[seat]?.[1];
    if (first === undefined || second === undefined) throw new RangeError('DECK_EXHAUSTED');
    holeCards[seat] = Object.freeze([first, second] as const);
  }
  return Object.freeze({
    deck: nextDeck,
    dealOrder,
    holeCards: Object.freeze(holeCards),
    board: Object.freeze([]),
    burnCards: Object.freeze([]),
  });
}

export function dealNextStreet(hand: DealtHand, street: 'flop' | 'turn' | 'river'): DealtHand {
  const transition =
    street === 'flop'
      ? { board: 0, burns: 0, count: 4 }
      : street === 'turn'
        ? { board: 3, burns: 1, count: 2 }
        : street === 'river'
          ? { board: 4, burns: 2, count: 2 }
          : null;
  if (
    !transition ||
    hand.board.length !== transition.board ||
    hand.burnCards.length !== transition.burns
  )
    throw new RangeError('INVALID_STREET_SEQUENCE');
  const dealt = draw(hand.deck, transition.count);
  const burn = dealt.cards[0];
  if (burn === undefined) throw new RangeError('DECK_EXHAUSTED');
  return Object.freeze({
    ...hand,
    deck: dealt.deck,
    board: Object.freeze([...hand.board, ...dealt.cards.slice(1)]),
    burnCards: Object.freeze([...hand.burnCards, burn]),
  });
}
