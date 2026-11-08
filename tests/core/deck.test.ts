import { describe, expect, it, vi } from 'vitest';
import {
  createDeck,
  createDeckState,
  draw,
  shuffleDeck,
  getDealOrder,
  dealHoleCards,
  dealNextStreet,
} from '../../packages/poker-core/src/index.js';
import type {
  DeckState,
  RandomInt,
  SeatId,
  DealtHand,
} from '../../packages/poker-core/src/index.js';
import { loadCardScenarios } from '../helpers/card-scenarios.js';

describe('private deck snapshots', () => {
  it('clones and freezes a complete input so future cards cannot be overwritten', () => {
    const input = createDeck();
    const state = createDeckState(input);
    input.reverse();
    expect(state.cards).toEqual(createDeck());
    expect(state.cursor).toBe(0);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.cards)).toBe(true);
    expect(() => {
      (state.cards as string[])[0] = 'AS';
    }).toThrow(TypeError);
  });
  it.each([0, 51, 53])('rejects a nonstandard deck size %s', (size) => {
    const deck = createDeck();
    const input = size === 53 ? [...deck, 'AS'] : deck.slice(0, size);
    expect(() => createDeckState(input)).toThrow('INVALID_DECK_SIZE');
  });
  it('rejects illegal identifiers and duplicates independently', () => {
    const invalid: unknown[] = createDeck();
    invalid[0] = 'TS';
    expect(() => createDeckState(invalid)).toThrow('INVALID_CARD');
    const duplicate = createDeck();
    duplicate[0] = 'AS';
    expect(() => createDeckState(duplicate)).toThrow('DUPLICATE_CARD');
  });
  it('consumes from the beginning without changing previous snapshots', () => {
    const state = createDeckState(Object.freeze(createDeck()));
    const before = structuredClone(state);
    const first = draw(state, 2);
    expect(first.cards).toEqual(['2S', '3S']);
    expect(first.deck.cursor).toBe(2);
    const next = draw(first.deck, 1);
    expect(next.cards).toEqual(['4S']);
    expect(next.deck.cursor).toBe(3);
    expect(state).toEqual(before);
    expect(first.deck.cursor).toBe(2);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.cards)).toBe(true);
  });
  it('supports zero draws and exact exhaustion without wrapping or dropping cards', () => {
    const state = createDeckState(createDeck());
    expect(draw(state, 0).cards).toEqual([]);
    expect(draw(state, 0).deck.cursor).toBe(0);
    const all = draw(state, 52);
    expect(all.cards).toEqual(createDeck());
    expect(all.deck.cursor).toBe(52);
    expect(draw(all.deck, 0).cards).toEqual([]);
    expect(() => draw(all.deck, 1)).toThrow('DECK_EXHAUSTED');
    expect(all.deck.cursor).toBe(52);
  });
  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid count %s atomically',
    (count) => {
      const state = createDeckState(createDeck());
      const before = structuredClone(state);
      expect(() => draw(state, count)).toThrow('INVALID_DRAW_COUNT');
      expect(state).toEqual(before);
    },
  );
  it('rejects counts exceeding the remaining cards atomically', () => {
    const state = draw(createDeckState(createDeck()), 50).deck;
    const before = structuredClone(state);
    expect(() => draw(state, 3)).toThrow('DECK_EXHAUSTED');
    expect(state).toEqual(before);
  });
  it.each([-1, 0.5, NaN, Infinity, 53])('rejects invalid internal cursor %s', (cursor) => {
    const state: DeckState = { cards: createDeck(), cursor };
    expect(() => draw(state, 1)).toThrow('INVALID_CURSOR');
  });
});

describe('injected Fisher–Yates shuffle', () => {
  it('C03 matches the frozen full permutation with fresh identical lower-bound stubs', () => {
    const { C03 } = loadCardScenarios();
    const input = Object.freeze([...C03.deck]);
    const results = Array.from({ length: C03.runs }, () => shuffleDeck(input, (min) => min));
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(C03.shuffledDeck);
    expect(results[1]).toEqual(C03.shuffledDeck);
    expect(results[0]).toEqual(results[1]);
    expect(C03.bothDecksEqual).toBe(true);
    expect(input).toEqual(C03.deck);
    expect(C03.inputUnchanged).toBe(true);
    expect(new Set(results[0]).size).toBe(C03.uniqueCardCount);
  });
  it('requests exactly 51 inclusive/exclusive ranges and allows the identity permutation', () => {
    const input = createDeck();
    const rng = vi.fn<RandomInt>((_min, max) => max - 1);
    expect(shuffleDeck(input, rng)).toEqual(input);
    expect(rng.mock.calls).toEqual(Array.from({ length: 51 }, (_, index) => [0, 52 - index]));
  });
  it.each([-1, 52, 0.5, NaN, Infinity, -Infinity])(
    'rejects a broken random source value %s without changing the input',
    (result) => {
      const input = Object.freeze(createDeck());
      const before = [...input];
      expect(() => shuffleDeck(input, () => result)).toThrow('INVALID_RANDOM_INDEX');
      expect(input).toEqual(before);
    },
  );
  it('rejects the exclusive upper endpoint even after earlier legal exchanges', () => {
    const input = createDeck();
    const before = [...input];
    let calls = 0;
    expect(() => shuffleDeck(input, (_min, max) => (++calls === 2 ? max : 0))).toThrow(
      'INVALID_RANDOM_INDEX',
    );
    expect(calls).toBe(2);
    expect(input).toEqual(before);
  });
  it('validates the full deck before consuming the random source', () => {
    const rng = vi.fn<RandomInt>(() => 0);
    expect(() => shuffleDeck(createDeck().slice(1), rng)).toThrow('INVALID_DECK_SIZE');
    const duplicate = createDeck();
    duplicate[0] = 'AS';
    expect(() => shuffleDeck(duplicate, rng)).toThrow('DUPLICATE_CARD');
    expect(rng).not.toHaveBeenCalled();
  });
  it('propagates an internal random source failure without changing the input', () => {
    const input = createDeck();
    const before = [...input];
    const failure = new Error('SOURCE_FAILURE');
    expect(() =>
      shuffleDeck(input, () => {
        throw failure;
      }),
    ).toThrow(failure);
    expect(input).toEqual(before);
  });
});

describe('two-round private cards and burned streets', () => {
  const { C02 } = loadCardScenarios();
  for (const variant of C02.variants)
    it(`C02 deals the original ${variant.seatIds.length}-player variant through every street`, () => {
      expect(C02.seatSets).toContainEqual(variant.seatIds);
      const initial = createDeckState(C02.deck);
      const hole = dealHoleCards(initial, variant.seatIds, C02.dealerSeatId);
      expect(hole.dealOrder).toEqual(variant.dealOrder);
      expect(hole.holeCards).toEqual(variant.holeCards);
      expect(hole.board).toEqual([]);
      expect(hole.burnCards).toEqual([]);
      expect(hole.deck.cursor).toBe(2 * variant.seatIds.length);
      const flop = dealNextStreet(hole, 'flop');
      expect(flop.board).toEqual(variant.board.slice(0, 3));
      expect(flop.burnCards).toEqual(variant.burnCards.slice(0, 1));
      expect(flop.deck.cursor).toBe(hole.deck.cursor + 4);
      const turn = dealNextStreet(flop, 'turn');
      expect(turn.board).toEqual(variant.board.slice(0, 4));
      expect(turn.burnCards).toEqual(variant.burnCards.slice(0, 2));
      expect(turn.deck.cursor).toBe(flop.deck.cursor + 2);
      const river = dealNextStreet(turn, 'river');
      expect(river.board).toEqual(variant.board);
      expect(river.burnCards).toEqual(variant.burnCards);
      expect(river.deck.cursor).toBe(variant.consumed);
      expect(river.deck.cards.slice(river.deck.cursor)).toHaveLength(52 - variant.consumed);
      const partition = [
        ...Object.values(river.holeCards).flat(),
        ...river.board,
        ...river.burnCards,
        ...river.deck.cards.slice(river.deck.cursor),
      ];
      expect(partition).toHaveLength(52);
      expect(new Set(partition).size).toBe(52);
      expect([...partition].sort()).toEqual([...C02.deck].sort());
      expect(initial.cursor).toBe(0);
      expect(hole.board).toEqual([]);
      expect(flop.board).toHaveLength(3);
      expect(turn.board).toHaveLength(4);
      expect(Object.isFrozen(river)).toBe(true);
      expect(Object.isFrozen(river.holeCards)).toBe(true);
      expect(Object.isFrozen(river.holeCards[variant.seatIds[0]!])).toBe(true);
      expect(Object.isFrozen(river.board)).toBe(true);
      expect(Object.isFrozen(river.burnCards)).toBe(true);
    });
  it('preserves sparse logical seat IDs and gives each player one card per round', () => {
    const seats: SeatId[] = [3, 1];
    const order = getDealOrder(seats, 3);
    expect(order).toEqual([1, 3]);
    expect(seats).toEqual([3, 1]);
    expect(dealHoleCards(createDeckState(createDeck()), seats, 3).holeCards).toEqual({
      1: ['2S', '4S'],
      3: ['3S', '5S'],
    });
    const three = dealHoleCards(createDeckState(createDeck()), [0, 2, 3], 2);
    expect(three.dealOrder).toEqual([3, 0, 2]);
    expect(three.holeCards).toEqual({ 3: ['2S', '5S'], 0: ['3S', '6S'], 2: ['4S', '7S'] });
  });
  it.each([[], [0], [0, 1, 2, 3, 0], [0, 0], [0, 4], [0, 1.5]].map((seats) => ({ seats })))(
    'rejects invalid participants $seats before consumption',
    ({ seats: rawSeats }) => {
      const state = createDeckState(createDeck());
      expect(() => dealHoleCards(state, rawSeats as SeatId[], 0)).toThrow('INVALID_SEATS');
      expect(state.cursor).toBe(0);
    },
  );
  it.each([2, 4, 0.5, NaN])('rejects absent or illegal dealer %s', (dealer) => {
    expect(() => getDealOrder([0, 1], dealer as SeatId)).toThrow('INVALID_DEALER');
  });
  it('rejects insufficient hole cards without moving the old cursor', () => {
    const state = draw(createDeckState(createDeck()), 49).deck;
    const before = structuredClone(state);
    expect(() => dealHoleCards(state, [0, 1], 0)).toThrow('DECK_EXHAUSTED');
    expect(state).toEqual(before);
  });
  it('rejects skipped, repeated, or unknown streets without changing old snapshots', () => {
    const hole = dealHoleCards(createDeckState(createDeck()), [0, 1], 0);
    const before = structuredClone(hole);
    expect(() => dealNextStreet(hole, 'turn')).toThrow('INVALID_STREET_SEQUENCE');
    expect(() => dealNextStreet(hole, 'river')).toThrow('INVALID_STREET_SEQUENCE');
    // @ts-expect-error Runtime callers can still supply an unknown street.
    expect(() => dealNextStreet(hole, 'preflop')).toThrow('INVALID_STREET_SEQUENCE');
    expect(hole).toEqual(before);
    const flop = dealNextStreet(hole, 'flop');
    expect(() => dealNextStreet(flop, 'flop')).toThrow('INVALID_STREET_SEQUENCE');
    const river = dealNextStreet(dealNextStreet(flop, 'turn'), 'river');
    const last = structuredClone(river);
    expect(() => dealNextStreet(river, 'river')).toThrow('INVALID_STREET_SEQUENCE');
    expect(river).toEqual(last);
  });
  it('rejects an inconsistent burn count before dealing a street', () => {
    const hole = dealHoleCards(createDeckState(createDeck()), [0, 1], 0);
    const malformed: DealtHand = { ...hole, burnCards: ['AS'] };
    expect(() => dealNextStreet(malformed, 'flop')).toThrow('INVALID_STREET_SEQUENCE');
  });
  it('rejects street exhaustion without returning a partial flop', () => {
    const tail = draw(createDeckState(createDeck()), 46).deck;
    const hole = dealHoleCards(tail, [0, 1], 0);
    const before = structuredClone(hole);
    expect(hole.deck.cursor).toBe(50);
    expect(() => dealNextStreet(hole, 'flop')).toThrow('DECK_EXHAUSTED');
    expect(hole).toEqual(before);
  });
});
