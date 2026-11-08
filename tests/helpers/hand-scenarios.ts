import { scenario, record, array, integer, seat, seats, cards } from './fixture-read.js';
import type { CreateHandInput } from '../../packages/poker-core/src/hand-types.js';
const operations: Record<string, string> = {
  S01: 'playPassiveHandVariants',
  S02: 'playHand',
  S03: 'playHand',
  S04: 'advanceUntilPlayerDecision',
  S05: 'advanceRepeatedly',
};
export function handFixture(id: string) {
  const operation = operations[id];
  if (!operation) throw new Error('UNKNOWN_HAND_FIXTURE');
  return scenario(id, [operation]);
}
export function handInput(id: string, variant?: unknown): CreateHandInput {
  const { given: g } = handFixture(id);
  if (integer(g.smallBlind) !== 10 || integer(g.bigBlind) !== 20)
    throw new Error('INVALID_FIXTURE_BLINDS');
  const ids = variant === undefined ? seats(g.seatIds) : seats(variant);
  return {
    handId: id,
    dealerSeatId: seat(g.dealerSeatId),
    deck: cards(g.deck),
    players: ids.map((seatId) => ({
      seatId,
      participantId: id + ':p:' + seatId,
      stack:
        g.initialStackPerSeat === undefined
          ? integer(record(g.initialStacks)[seatId])
          : integer(g.initialStackPerSeat),
    })),
  };
}
export function passiveVariants() {
  const r = handFixture('S01');
  return array(r.given.seatSets).map((set, i) => ({
    input: handInput('S01', set),
    expected: record(array(r.expected.variants)[i]),
  }));
}
