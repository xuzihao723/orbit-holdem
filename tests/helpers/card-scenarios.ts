import scenarios from '../fixtures/scenarios.json';
import type { CardId, SeatId } from '../../packages/poker-core/src/index.js';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_CARD_FIXTURE_OBJECT');
  return value as RecordValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('INVALID_CARD_FIXTURE_ARRAY');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('INVALID_CARD_FIXTURE_INTEGER');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('INVALID_CARD_FIXTURE_BOOLEAN');
  return value;
}
function strings(value: unknown): string[] {
  return array(value).map((item) => {
    if (typeof item !== 'string') throw new Error('INVALID_CARD_FIXTURE_STRING');
    return item;
  });
}
function cards(value: unknown, length: number): CardId[] {
  const result = array(value).map((item): CardId => {
    if (typeof item !== 'string' || !/^(?:[2-9]|10|J|Q|K|A)[SHCD]$/.test(item))
      throw new Error('INVALID_CARD_FIXTURE_CARD');
    return item as CardId;
  });
  if (result.length !== length) throw new Error('INVALID_CARD_FIXTURE_LENGTH');
  return result;
}
function seat(value: unknown): SeatId {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3)
    throw new Error('INVALID_CARD_FIXTURE_SEAT');
  return value;
}
function seats(value: unknown): SeatId[] {
  return array(value).map(seat);
}
function pair(value: unknown): readonly [CardId, CardId] {
  const result = cards(value, 2);
  const [first, second] = result;
  if (!first || !second) throw new Error('INVALID_CARD_FIXTURE_PAIR');
  return [first, second];
}
export function loadCardScenarios(input: unknown = scenarios) {
  const entries = array(input).map(record);
  function select(id: string, operation: string) {
    const matches = entries.filter((entry) => entry.id === id);
    if (matches.length !== 1) throw new Error('MISSING_OR_DUPLICATE_CARD_SCENARIO:' + id);
    const entry = matches[0];
    if (!entry || record(entry.when).operation !== operation)
      throw new Error('INVALID_CARD_SCENARIO_OPERATION:' + id);
    return { given: record(entry.given), expected: record(entry.expected) };
  }
  const c01 = select('C01', 'createDeck');
  const c02 = select('C02', 'dealThroughRiverVariants');
  const c03 = select('C03', 'shuffleTwiceWithFreshIdenticalStub');
  const counts = record(c01.expected.suitCounts);
  if (c03.given.randomIntStub !== 'alwaysReturnLowerBound' || c03.given.runs !== 2)
    throw new Error('INVALID_CARD_FIXTURE_STUB');
  const variants = array(c02.expected.variants).map((value) => {
    const variant = record(value);
    const seatIds = seats(variant.seatIds);
    const rawHoles = record(variant.holeCards);
    const holeCards: Partial<Record<SeatId, readonly [CardId, CardId]>> = {};
    for (const id of seatIds) holeCards[id] = pair(rawHoles[String(id)]);
    return {
      seatIds,
      dealOrder: seats(variant.dealOrder),
      holeCards,
      burnCards: cards(variant.burnCards, 3),
      board: cards(variant.board, 5),
      consumed: integer(variant.consumed),
    };
  });
  if (variants.length !== 3) throw new Error('INVALID_CARD_FIXTURE_VARIANTS');
  return {
    C01: {
      suitOrder: strings(c01.given.suitOrder),
      rankOrder: strings(c01.given.rankOrder),
      cardCount: integer(c01.expected.cardCount),
      uniqueCardCount: integer(c01.expected.uniqueCardCount),
      suitCounts: {
        S: integer(counts.S),
        H: integer(counts.H),
        C: integer(counts.C),
        D: integer(counts.D),
      },
      deckOrder: cards(c01.expected.deckOrder, 52),
    },
    C02: {
      deck: cards(c02.given.deck, 52),
      dealerSeatId: seat(c02.given.dealerSeatId),
      seatSets: array(c02.given.seatSets).map(seats),
      variants,
    },
    C03: {
      deck: cards(c03.given.deck, 52),
      runs: integer(c03.given.runs),
      bothDecksEqual: boolean(c03.expected.bothDecksEqual),
      inputUnchanged: boolean(c03.expected.inputUnchanged),
      uniqueCardCount: integer(c03.expected.uniqueCardCount),
      shuffledDeck: cards(c03.expected.shuffledDeck, 52),
    },
  };
}
