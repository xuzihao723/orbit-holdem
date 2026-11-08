import { expect, it } from 'vitest';
import {
  getLegalActions,
  applyBettingAmount,
  assertBettingRound,
  hasRaiseRight,
  getResponsiveOpponentSeatIds,
} from '../../packages/poker-core/src/betting.js';
import type {
  BettingRound,
  BettingPlayer,
  AmountResult,
} from '../../packages/poker-core/src/betting-types.js';
import { loadBettingRoundFixture, decodeFixtureNumber } from '../helpers/betting-scenarios.js';
import { array, integer } from '../helpers/fixture-read.js';
export function simpleRound(overrides: Partial<BettingRound> = {}): BettingRound {
  return {
    street: 'flop',
    bigBlind: 20,
    currentBet: 0,
    lastFullRaiseSize: 20,
    actorSeatId: 0,
    actionOrder: [0, 1],
    pendingSeatIds: [0, 1],
    players: [0, 1].map((seatId) => ({
      seatId: seatId as 0 | 1,
      stack: 1000,
      streetCommitted: 0,
      handCommitted: 0,
      folded: false,
      allIn: false,
      lastActedAtBet: null,
    })),
    ...overrides,
  };
}
function success(result: AmountResult) {
  if (!result.ok) throw new Error(result.reason);
  return result.effect;
}
for (const id of ['B01', 'B02', 'B09', 'O05'])
  it(id + ' reads original legal amounts and actions', () => {
    const { round, expected: e } = loadBettingRoundFixture(id),
      legal = getLegalActions(round, round.actorSeatId!);
    if (e.legalActions !== undefined) expect(legal.allowed).toEqual(e.legalActions);
    for (const key of ['callAmount', 'minRaiseTo', 'maxRaiseTo'] as const)
      if (e[key] !== undefined) expect(legal[key]).toEqual(e[key]);
    if (e.additionalAmountAtMinRaise !== undefined)
      expect(
        legal.minRaiseTo! -
          round.players.find((p) => p.seatId === round.actorSeatId)!.streetCommitted,
      ).toBe(e.additionalAmountAtMinRaise);
  });
it('B08 resolves a short all-in call without changing the line or pretending normal call is legal', () => {
  const { round, expected: e } = loadBettingRoundFixture('B08'),
    legal = getLegalActions(round, 0);
  expect(legal.allowed).toEqual(e.legalActions);
  expect(legal.callAmount).toBe(100);
  expect(legal.allIn?.additionalAmount).toBe(e.allInAmount);
  const effect = success(applyBettingAmount(round, 0, { type: 'allIn' }));
  expect(effect.players[0]?.stack).toBe(e.newStack);
  expect(effect.players[0]?.streetCommitted).toBe(e.newStreetCommitted);
  expect(effect.currentBet).toBe(e.currentBet);
  expect(effect.raiseClass).toBe('none');
  expect(applyBettingAmount(round, 0, { type: 'call' })).toMatchObject({
    ok: false,
    reason: 'ILLEGAL_ACTION',
  });
});
it('B10 rejects all six actions from the wrong actor with the original state', () => {
  const { round, when, expected: e } = loadBettingRoundFixture('B10'),
    before = structuredClone(round),
    actions = array(when.actions);
  expect(actions).toHaveLength(integer(e.rejectedCount));
  for (const action of actions) {
    const r = applyBettingAmount(round, 1, action);
    expect(r).toMatchObject({ ok: false, reason: e.reason });
    if (r.ok) throw new Error('accepted');
    expect(r.state).toBe(round);
    expect(round).toEqual(before);
  }
});
it('B11 rejects all nine unsafe or invalid raises without coercion or mutation', () => {
  const { round, when, expected: e } = loadBettingRoundFixture('B11'),
    before = structuredClone(round),
    values = array(when.raiseToValues);
  expect(values).toHaveLength(integer(e.rejectedCount));
  for (const value of values) {
    const r = applyBettingAmount(round, 0, { type: 'raise', raiseTo: decodeFixtureNumber(value) });
    expect(r).toMatchObject({ ok: false, reason: e.reason });
    if (r.ok) throw new Error('accepted');
    expect(r.state).toBe(round);
    expect(round).toEqual(before);
  }
});
it('moves only target minus prior street investment and preserves chip conservation', () => {
  const original = loadBettingRoundFixture('B02').round,
    before = structuredClone(original),
    effect = success(applyBettingAmount(original, 1, { type: 'raise', raiseTo: 100 }));
  expect(effect.paidAmount).toBe(80);
  expect(effect.players[1]?.stack).toBe(1900);
  expect(effect.players[1]?.handCommitted).toBe(100);
  expect(effect.lastFullRaiseSize).toBe(40);
  expect(effect.players.reduce((s, p) => s + p.stack + p.handCommitted, 0)).toBe(
    original.players.reduce((s, p) => s + p.stack + p.handCommitted, 0),
  );
  expect(original).toEqual(before);
  expect(Object.isFrozen(effect)).toBe(true);
  expect(Object.isFrozen(effect.players)).toBe(true);
  expect(effect.players.every(Object.isFrozen)).toBe(true);
  expect('actorSeatId' in effect).toBe(false);
  expect('pendingSeatIds' in effect).toBe(false);
});
it('opens at20 and distinguishes a short all-in from an illegal ordinary bet', () => {
  const r = simpleRound();
  expect(getLegalActions(r, 0).allowed).toEqual(['fold', 'check', 'bet', 'allIn']);
  expect(getLegalActions(r, 0).minRaiseTo).toBe(20);
  expect(success(applyBettingAmount(r, 0, { type: 'bet', raiseTo: 100 }))).toMatchObject({
    paidAmount: 100,
    currentBet: 100,
    lastFullRaiseSize: 100,
    raiseClass: 'full',
  });
  const short = simpleRound({
    players: r.players.map((p) => (p.seatId === 0 ? { ...p, stack: 10 } : p)),
  });
  expect(getLegalActions(short, 0)).toMatchObject({
    allowed: ['fold', 'check', 'allIn'],
    minRaiseTo: null,
    maxRaiseTo: null,
    allIn: { raiseTo: 10, additionalAmount: 10, kind: 'bet' },
  });
  expect(success(applyBettingAmount(short, 0, { type: 'allIn' }))).toMatchObject({
    currentBet: 10,
    lastFullRaiseSize: 20,
    raiseClass: 'short',
  });
  expect(applyBettingAmount(short, 0, { type: 'bet', raiseTo: 10 })).toMatchObject({
    ok: false,
    reason: 'ILLEGAL_AMOUNT',
  });
});
it('requires exact remaining-chip calls to use allIn and never silently changes raise intent', () => {
  const base = loadBettingRoundFixture('B01').round,
    player = base.players[0]!;
  const r = {
    ...base,
    players: base.players.map((p) => (p.seatId === 0 ? { ...p, stack: 10 } : p)),
  };
  expect(getLegalActions(r, 0).allowed).toEqual(['fold', 'allIn']);
  expect(success(applyBettingAmount(r, 0, { type: 'allIn' })).paidAmount).toBe(10);
  const short = { ...base, players: [{ ...player, stack: 20 }, base.players[1]!] };
  expect(getLegalActions(short, 0).allowed).toEqual(['fold', 'call', 'allIn']);
  expect(getLegalActions(short, 0).minRaiseTo).toBeNull();
  expect(applyBettingAmount(short, 0, { type: 'raise', raiseTo: 30 })).toMatchObject({
    ok: false,
    reason: 'ILLEGAL_AMOUNT',
  });
});
it('gives nonactors no actions and never grants a raise without a responsive opponent', () => {
  const r = loadBettingRoundFixture('B09').round;
  expect(getLegalActions(r, 1)).toEqual({
    allowed: [],
    callAmount: 0,
    minRaiseTo: null,
    maxRaiseTo: null,
    allIn: null,
  });
  expect(getResponsiveOpponentSeatIds(r, 0)).toEqual([]);
  expect(hasRaiseRight(r, 0)).toBe(true);
  expect(applyBettingAmount(r, 0, { type: 'allIn' })).toMatchObject({
    ok: false,
    reason: 'ILLEGAL_ACTION',
  });
});
it.each([
  null,
  [],
  { type: 'unknown' },
  { type: 'fold', raiseTo: 1 },
  { type: 'call', amount: 20 },
  Object.create({ type: 'fold' }),
])('rejects malformed action %j', (action) => {
  const r = simpleRound(),
    before = structuredClone(r);
  expect(applyBettingAmount(r, 0, action)).toMatchObject({ ok: false, reason: 'ILLEGAL_ACTION' });
  expect(r).toEqual(before);
});
it('does not update action history during the amount-only stage', () => {
  const r = loadBettingRoundFixture('B01').round,
    e = success(applyBettingAmount(r, 0, { type: 'call' }));
  expect(e.players[0]?.lastActedAtBet).toBeNull();
});
it('rejects inconsistent rounds, sparse members, and unsafe aggregate totals', () => {
  const base = simpleRound();
  const invalid: BettingRound[] = [
    { ...base, currentBet: -1 },
    { ...base, players: base.players.map((p) => ({ ...p, stack: Number.MAX_SAFE_INTEGER })) },
    { ...base, actionOrder: [0, 0] },
    { ...base, pendingSeatIds: [1], actorSeatId: 0 },
    { ...base, players: base.players.map((p) => (p.seatId === 0 ? { ...p, allIn: true } : p)) },
    { ...base, players: new Array<BettingPlayer>(2) },
  ];
  for (const state of invalid)
    expect(() => assertBettingRound(state)).toThrow('INVALID_BETTING_STATE');
});
it('omits an overflowing full-raise minimum but keeps a legal short all-in', () => {
  const n = Number.MAX_SAFE_INTEGER,
    base = simpleRound();
  const r: BettingRound = {
    ...base,
    currentBet: n - 50,
    lastFullRaiseSize: 100,
    players: [
      { ...base.players[0]!, stack: 60, streetCommitted: n - 100, handCommitted: n - 100 },
      { ...base.players[1]!, stack: 40 },
    ],
  };
  expect(getLegalActions(r, 0)).toMatchObject({
    allowed: ['fold', 'call', 'allIn'],
    minRaiseTo: null,
    maxRaiseTo: null,
  });
  expect(success(applyBettingAmount(r, 0, { type: 'allIn' }))).toMatchObject({
    paidAmount: 60,
    currentBet: n - 40,
    lastFullRaiseSize: 100,
    raiseClass: 'short',
  });
  expect(applyBettingAmount(r, 0, { type: 'raise', raiseTo: n })).toMatchObject({
    ok: false,
    reason: 'ILLEGAL_AMOUNT',
  });
});
