import { expect, it } from 'vitest';
import {
  createDeck,
  parseCard,
  isCardId,
  SUITS,
  RANKS,
} from '../../packages/poker-core/src/index.js';
import { loadCardScenarios } from '../helpers/card-scenarios.js';
import rawScenarios from '../fixtures/scenarios.json';
const { C01 } = loadCardScenarios();
it('C01 generates the original complete standard deck in its frozen order', () => {
  const deck = createDeck();
  expect(deck).toEqual(C01.deckOrder);
  expect(deck).toHaveLength(C01.cardCount);
  expect(new Set(deck).size).toBe(C01.uniqueCardCount);
  expect(SUITS).toEqual(C01.suitOrder);
  expect(RANKS).toEqual(C01.rankOrder);
  for (const suit of C01.suitOrder)
    expect(deck.filter((card) => card.endsWith(suit))).toHaveLength(
      C01.suitCounts[suit as keyof typeof C01.suitCounts],
    );
});
it('parses every frozen card with its independent numeric rank and suit', () => {
  for (const card of C01.deckOrder) {
    expect(isCardId(card)).toBe(true);
    expect(parseCard(card)).toEqual({
      id: card,
      suit: card.slice(-1),
      rank: card.slice(0, -1),
      value: C01.rankOrder.indexOf(card.slice(0, -1)) + 2,
    });
  }
  expect(parseCard('10H').value).toBe(10);
  expect(parseCard('AS').value).toBe(14);
});
it.each([
  'TS',
  '1S',
  '11H',
  'as',
  ' AS',
  'AS ',
  'A S',
  'AX',
  '10',
  '10HH',
  '',
  null,
  undefined,
  10,
  {},
  ['AS'],
])('rejects nonstandard card %j', (value) => {
  expect(isCardId(value)).toBe(false);
  expect(() => parseCard(value)).toThrow(new TypeError('INVALID_CARD'));
});
it('returns independent arrays and protects the canonical lookup from caller mutation', () => {
  const first = createDeck();
  const second = createDeck();
  first.pop();
  first[0] = 'AS';
  expect(second).toEqual(C01.deckOrder);
  expect(createDeck()).toEqual(C01.deckOrder);
  expect(isCardId('AD')).toBe(true);
  expect(Object.isFrozen(SUITS)).toBe(true);
  expect(Object.isFrozen(RANKS)).toBe(true);
});
it('rejects missing, duplicate or wrongly named fixture operations without silent skips', () => {
  const c01 = rawScenarios.find((row) => row.id === 'C01');
  if (!c01) throw new Error('Missing original C01');
  expect(() => loadCardScenarios(rawScenarios.filter((row) => row.id !== 'C01'))).toThrow(
    'MISSING_OR_DUPLICATE_CARD_SCENARIO:C01',
  );
  expect(() => loadCardScenarios([...rawScenarios, c01])).toThrow(
    'MISSING_OR_DUPLICATE_CARD_SCENARIO:C01',
  );
  expect(() =>
    loadCardScenarios(
      rawScenarios.map((row) =>
        row.id === 'C01' ? { ...row, when: { operation: 'skipMe' } } : row,
      ),
    ),
  ).toThrow('INVALID_CARD_SCENARIO_OPERATION:C01');
});
