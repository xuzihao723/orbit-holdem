import { scenario, record, array, integer, seat, text } from './fixture-read.js';
import { expectedPlayer } from './position-scenarios.js';
import type { Action, BettingRound, Street } from '../../packages/poker-core/src/betting-types.js';
const operations: Record<string, string> = {
  O05: 'getLegalActions',
  B01: 'getLegalActions',
  B02: 'getLegalActions',
  B03: 'getLegalActions',
  B04: 'getLegalActions',
  B05: 'getLegalActions',
  B06: 'getLegalActions',
  B07: 'getLegalActions',
  B08: 'getLegalActionsAndApply',
  B09: 'getLegalActions',
  B10: 'applyActionVariants',
  B11: 'applyInvalidRaises',
  B12: 'applyAction',
};
export function loadBettingRoundFixture(id: string) {
  const operation = operations[id];
  if (!operation) throw new Error('UNKNOWN_BETTING_FIXTURE');
  const r = scenario(id, [operation]),
    g = r.given;
  const street = text(g.street);
  if (!['preflop', 'flop', 'turn', 'river'].includes(street))
    throw new Error('INVALID_FIXTURE_STREET');
  const players = array(g.players).map(expectedPlayer),
    actorSeatId = seat(g.actorSeatId),
    currentBet = integer(g.currentBet);
  const actionOrder = players.map((p) => p.seatId).sort((a, b) => a - b);
  const needs = players
    .filter(
      (p) =>
        !p.folded &&
        !p.allIn &&
        p.stack > 0 &&
        (p.lastActedAtBet === null || p.streetCommitted < currentBet),
    )
    .map((p) => p.seatId);
  const index = actionOrder.indexOf(actorSeatId),
    cycle = [...actionOrder.slice(index), ...actionOrder.slice(0, index)];
  const round: BettingRound = {
    street: street as Street,
    bigBlind: integer(g.bigBlind),
    currentBet,
    lastFullRaiseSize: integer(g.lastFullRaiseSize),
    players,
    actionOrder,
    pendingSeatIds: cycle.filter((s) => needs.includes(s)),
    actorSeatId,
  };
  return { round, expected: r.expected, when: r.when };
}
export function loadBettingHistory(id: 'B03' | 'B12') {
  const source = scenario(id, [operations[id]!]);
  return array(source.given.history).map((value) => {
    const step = record(value),
      type = text(step.type);
    let action: Action;
    if (type === 'bet' || type === 'raise') action = { type, raiseTo: integer(step.raiseTo) };
    else if (type === 'fold' || type === 'check' || type === 'call' || type === 'allIn')
      action = { type };
    else throw new Error('INVALID_FIXTURE_ACTION');
    return {
      seatId: seat(step.seatId),
      action,
      resolvedRaiseTo: step.resolvedRaiseTo === undefined ? null : integer(step.resolvedRaiseTo),
    };
  });
}
export function decodeFixtureNumber(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const r = record(value);
  if (Object.keys(r).length !== 1) throw new Error('INVALID_FIXTURE_NUMBER_TAG');
  if (r.$jsNumber === 'NaN') return NaN;
  if (r.$jsNumber === 'Infinity') return Infinity;
  if (r.$jsNumber === '-Infinity') return -Infinity;
  if (r.$jsValue === 'undefined') return undefined;
  throw new Error('INVALID_FIXTURE_NUMBER_TAG');
}
