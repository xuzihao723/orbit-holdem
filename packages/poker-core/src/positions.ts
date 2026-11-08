import { getDealOrder, type SeatId, type RandomInt } from './deck.js';
import type { BettingPlayer, Street } from './betting-types.js';
export interface Positions {
  readonly dealerSeatId: SeatId;
  readonly smallBlindSeatId: SeatId;
  readonly bigBlindSeatId: SeatId;
  readonly dealOrder: readonly SeatId[];
  readonly preflopOrder: readonly SeatId[];
  readonly postflopOrder: readonly SeatId[];
}
export interface PreviousPositions {
  readonly seatIds: readonly SeatId[];
  readonly dealerSeatId: SeatId;
  readonly bigBlindSeatId: SeatId;
  readonly continuedSeatIds: readonly SeatId[];
}
export interface BlindPosting {
  readonly players: readonly BettingPlayer[];
  readonly currentBet: 20;
  readonly lastFullRaiseSize: 20;
  readonly initialChipTotal: number;
  readonly potTotal: number;
}
function validSeats(seats: readonly SeatId[]): void {
  getDealOrder(seats, seats[0]!);
}
export function chooseFirstDealer(seatIds: readonly SeatId[], randomInt: RandomInt): SeatId {
  validSeats(seatIds);
  const sorted = [...seatIds].sort((a, b) => a - b),
    index = randomInt(0, sorted.length);
  if (!Number.isSafeInteger(index) || index < 0 || index >= sorted.length)
    throw new RangeError('INVALID_RANDOM_INDEX');
  return sorted[index]!;
}
export function resolvePositions(seatIds: readonly SeatId[], dealer: SeatId): Positions {
  const dealOrder = getDealOrder(seatIds, dealer),
    headsUp = seatIds.length === 2;
  const smallBlindSeatId = headsUp ? dealer : dealOrder[0]!;
  const bigBlindSeatId = headsUp ? dealOrder[0]! : dealOrder[1]!;
  const index = dealOrder.indexOf(bigBlindSeatId);
  return Object.freeze({
    dealerSeatId: dealer,
    smallBlindSeatId,
    bigBlindSeatId,
    dealOrder,
    preflopOrder: Object.freeze([...dealOrder.slice(index + 1), ...dealOrder.slice(0, index + 1)]),
    postflopOrder: Object.freeze([...dealOrder]),
  });
}
function assertPositions(p: Positions): void {
  try {
    const expected = resolvePositions(p.dealOrder, p.dealerSeatId);
    if (
      p.smallBlindSeatId !== expected.smallBlindSeatId ||
      p.bigBlindSeatId !== expected.bigBlindSeatId
    )
      throw new Error('MISMATCH');
    for (const key of ['dealOrder', 'preflopOrder', 'postflopOrder'] as const) {
      const actual = p[key];
      if (
        !Array.isArray(actual) ||
        actual.length !== expected[key].length ||
        Array.from(actual).some((s, i) => s !== expected[key][i])
      )
        throw new Error('MISMATCH');
    }
  } catch {
    throw new RangeError('INVALID_POSITIONS');
  }
}
export function resolveNextPositions(
  previous: PreviousPositions,
  nextSeatIds: readonly SeatId[],
): Positions {
  validSeats(nextSeatIds);
  try {
    const old = resolvePositions(previous.seatIds, previous.dealerSeatId);
    if (
      old.bigBlindSeatId !== previous.bigBlindSeatId ||
      !Array.isArray(previous.continuedSeatIds) ||
      new Set(previous.continuedSeatIds).size !== previous.continuedSeatIds.length
    )
      throw new Error('MISMATCH');
    for (const seat of previous.continuedSeatIds)
      if (!previous.seatIds.includes(seat) || !nextSeatIds.includes(seat))
        throw new Error('MISMATCH');
  } catch {
    throw new RangeError('INVALID_PREVIOUS_POSITIONS');
  }
  if (
    previous.seatIds.length >= 3 &&
    nextSeatIds.length === 2 &&
    previous.continuedSeatIds.includes(previous.bigBlindSeatId)
  )
    return resolvePositions(nextSeatIds, previous.bigBlindSeatId);
  for (let step = 1; step <= 4; step++) {
    const seat = ((previous.dealerSeatId + step) % 4) as SeatId;
    if (nextSeatIds.includes(seat)) return resolvePositions(nextSeatIds, seat);
  }
  throw new RangeError('INVALID_SEATS');
}
export function postBlinds(
  players: readonly { seatId: SeatId; stack: number }[],
  positions: Positions,
): BlindPosting {
  assertPositions(positions);
  validSeats(players.map((p) => p.seatId));
  if (
    players.length !== positions.dealOrder.length ||
    players.some((p) => !positions.dealOrder.includes(p.seatId))
  )
    throw new RangeError('INVALID_POSITIONS');
  let total = 0;
  for (const p of players) {
    if (!Number.isSafeInteger(p.stack) || p.stack <= 0) throw new RangeError('INVALID_STACK');
    total += p.stack;
    if (!Number.isSafeInteger(total)) throw new RangeError('UNSAFE_CHIP_TOTAL');
  }
  const posted = players.map((p): BettingPlayer => {
    const amount = Math.min(
      p.stack,
      p.seatId === positions.smallBlindSeatId ? 10 : p.seatId === positions.bigBlindSeatId ? 20 : 0,
    );
    return Object.freeze({
      seatId: p.seatId,
      stack: p.stack - amount,
      streetCommitted: amount,
      handCommitted: amount,
      folded: false,
      allIn: p.stack === amount,
      lastActedAtBet: null,
    });
  });
  return Object.freeze({
    players: Object.freeze(posted),
    currentBet: 20,
    lastFullRaiseSize: 20,
    initialChipTotal: total,
    potTotal: posted.reduce((sum, p) => sum + p.handCommitted, 0),
  });
}
export function getActionOrder(
  positions: Positions,
  street: Street,
  players: readonly BettingPlayer[],
): readonly SeatId[] {
  assertPositions(positions);
  if (!['preflop', 'flop', 'turn', 'river'].includes(street))
    throw new RangeError('INVALID_POSITIONS');
  return Object.freeze(
    (street === 'preflop' ? positions.preflopOrder : positions.postflopOrder).filter((seat) =>
      players.some((p) => p.seatId === seat && !p.folded && !p.allIn && p.stack > 0),
    ),
  );
}
