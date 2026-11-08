import { scenario, array, record, seats, seat, integer, bool } from './fixture-read.js';
import type { BettingPlayer } from '../../packages/poker-core/src/betting-types.js';
export function expectedPlayer(value: unknown): BettingPlayer {
  const p = record(value);
  return {
    seatId: seat(p.seatId),
    stack: integer(p.stack),
    streetCommitted: integer(p.streetCommitted),
    handCommitted: integer(p.handCommitted),
    folded: bool(p.folded),
    allIn: bool(p.allIn),
    lastActedAtBet: p.lastActedAtBet === null ? null : integer(p.lastActedAtBet),
  };
}
export function loadPositionScenarios() {
  const one = scenario('O01', ['resolvePositions']);
  const given = array(one.given.variants),
    expected = array(one.expected.variants);
  const variants = given.map((v, i) => {
    const g = record(v),
      e = record(expected[i]);
    return {
      seats: seats(g.seatIds),
      dealer: seat(g.dealerSeatId),
      expected: {
        smallBlindSeatId: seat(e.smallBlindSeatId),
        bigBlindSeatId: seat(e.bigBlindSeatId),
        preflopOrder: seats(e.preflopOrder),
        postflopOrder: seats(e.postflopOrder),
      },
    };
  });
  const two = scenario('O02', ['resolvePositions']),
    three = scenario('O03', ['resolveNextHandPositions']),
    four = scenario('O04', ['postBlinds']);
  const oldSeats = seats(three.given.previousSeatIds),
    next = seats(three.given.nextSeatIds),
    stacks = record(four.given.initialStacks);
  return {
    variants,
    two: {
      seats: seats(two.given.seatIds),
      dealer: seat(two.given.dealerSeatId),
      expected: {
        smallBlindSeatId: seat(two.expected.smallBlindSeatId),
        bigBlindSeatId: seat(two.expected.bigBlindSeatId),
        preflopOrder: seats(two.expected.preflopOrder),
        postflopOrder: seats(two.expected.postflopOrder),
        dealOrder: seats(two.expected.dealOrder),
      },
    },
    three: {
      previous: {
        seatIds: oldSeats,
        dealerSeatId: seat(three.given.previousDealerSeatId),
        bigBlindSeatId: seat(three.given.previousBigBlindSeatId),
        continuedSeatIds: oldSeats.filter((s) => next.includes(s)),
      },
      next,
      expected: {
        dealerSeatId: seat(three.expected.dealerSeatId),
        smallBlindSeatId: seat(three.expected.smallBlindSeatId),
        bigBlindSeatId: seat(three.expected.bigBlindSeatId),
        preflopOrder: seats(three.expected.preflopOrder),
        postflopOrder: seats(three.expected.postflopOrder),
      },
    },
    four: {
      seats: seats(four.given.seatIds),
      dealer: seat(four.given.dealerSeatId),
      players: seats(four.given.seatIds).map((seatId) => ({
        seatId,
        stack: integer(stacks[String(seatId)]),
      })),
      expected: {
        players: array(four.expected.players).map(expectedPlayer),
        currentBet: integer(four.expected.currentBet),
        lastFullRaiseSize: integer(four.expected.lastFullRaiseSize),
        initialChipTotal: integer(four.expected.initialChipTotal),
        potTotal: integer(four.expected.potTotal),
      },
    },
  };
}
