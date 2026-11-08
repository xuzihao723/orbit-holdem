import { scenario, cards, record, numbers, integer, array, text } from './fixture-read.js';
export function loadEvaluationScenarios() {
  const singles = ['E01', 'E02', 'E03', 'E04', 'RANK01', 'RANK02', 'RANK03', 'RANK04'].map((id) => {
    const r = scenario(id, ['evaluateBest']);
    return {
      id,
      cards: cards(r.given.cards),
      category: integer(r.expected.category),
      tieBreak: numbers(r.expected.tieBreak),
      bestFiveSet: r.expected.bestFiveSet === undefined ? null : cards(r.expected.bestFiveSet),
    };
  });
  const e05 = scenario('E05', ['comparePlayers']),
    hole = record(e05.given.holeCards),
    board = cards(e05.given.board);
  const e06 = scenario('E06', ['compareHands']),
    hands = record(e06.given.hands),
    ranks = record(e06.expected.ranks);
  const e07 = scenario('E07', ['evaluateInvalidInputs']);
  return {
    singles,
    shared: {
      hands: [board.concat(cards(hole['0'])), board.concat(cards(hole['1']))],
      category: integer(e05.expected.category),
      tieBreak: numbers(e05.expected.tieBreak),
      bestFiveSet: cards(e05.expected.bestFiveSet),
    },
    kickers: {
      hands: [cards(hands['0']), cards(hands['1'])],
      ranks: [numbers(ranks['0']), numbers(ranks['1'])],
      winner: numbers(e06.expected.winnerSeatIds),
    },
    invalid: {
      inputs: array(e07.given.invalidInputs).map(cards),
      reasons: array(e07.expected.reasons).map(text),
      count: integer(e07.expected.rejectedCount),
    },
  };
}
