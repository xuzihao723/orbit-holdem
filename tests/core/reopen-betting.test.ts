import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  beginBettingRound,
  applyBettingAction,
  getRoundOutcome,
  getLegalActions,
  hasRaiseRight,
  getResponsiveOpponentSeatIds,
} from '../../packages/poker-core/src/betting.js';
import { resolvePositions, postBlinds } from '../../packages/poker-core/src/positions.js';
import type {
  Action,
  BettingRound,
  BettingPlayer,
} from '../../packages/poker-core/src/betting-types.js';
import { seat } from '../helpers/fixture-read.js';
import { loadBettingRoundFixture, loadBettingHistory } from '../helpers/betting-scenarios.js';

function start(stacks: readonly number[]): BettingRound {
  return beginBettingRound({
    street: 'flop',
    bigBlind: 20,
    actionOrder: stacks.map((_, i) => seat(i)),
    players: stacks.map((stack, i) => ({
      seatId: seat(i),
      stack,
      streetCommitted: 0,
      handCommitted: 0,
      folded: false,
      allIn: stack === 0,
      lastActedAtBet: null,
    })),
  });
}
function play(round: BettingRound, action: Action) {
  const before = structuredClone(round),
    actor = round.actorSeatId;
  if (actor === null) throw new Error('NO_ACTOR');
  const result = applyBettingAction(round, actor, action);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(round).toEqual(before);
  expect(result.state.players.find((p) => p.seatId === actor)?.lastActedAtBet).toBe(
    result.state.currentBet,
  );
  for (const p of round.players.filter((p) => p.seatId !== actor))
    expect(result.state.players.find((n) => n.seatId === p.seatId)?.lastActedAtBet).toBe(
      p.lastActedAtBet,
    );
  expect(result.state.players.reduce((sum, p) => sum + p.stack + p.handCommitted, 0)).toBe(
    round.players.reduce((sum, p) => sum + p.stack + p.handCommitted, 0),
  );
  expect(result.effect.paidAmount).toBe(
    round.players.find((p) => p.seatId === actor)!.stack -
      result.state.players.find((p) => p.seatId === actor)!.stack,
  );
  expect(getRoundOutcome(result.state)).toBe(result.outcome);
  expect(Object.isFrozen(result.state)).toBe(true);
  expect(Object.isFrozen(result.state.players)).toBe(true);
  expect(Object.isFrozen(result.state.pendingSeatIds)).toBe(true);
  return result;
}
const bet100: Action = { type: 'bet', raiseTo: 100 },
  allIn: Action = { type: 'allIn' },
  call: Action = { type: 'call' },
  fold: Action = { type: 'fold' },
  check: Action = { type: 'check' };
const trajectories = [
  {
    id: 'B03',
    stacks: [1000, 150, 1000, 1000],
    actions: [bet100, allIn, call, fold],
    actors: [1, 2, 3, 0],
    lines: [100, 150, 150, 150],
    full: [100, 100, 100, 100],
    paid: [100, 150, 150, 0],
  },
  {
    id: 'B04',
    stacks: [1000, 150, 200, 1000],
    actions: [bet100, allIn, allIn, call],
    actors: [1, 2, 3, 0],
    lines: [100, 150, 200, 200],
    full: [100, 100, 100, 100],
    paid: [100, 150, 200, 200],
  },
  {
    id: 'B05',
    stacks: [1000, 150, 1000, 200],
    actions: [bet100, allIn, call, allIn, call],
    actors: [1, 2, 3, 0, 2],
    lines: [100, 150, 150, 200, 200],
    full: [100, 100, 100, 100, 100],
    paid: [100, 150, 150, 200, 100],
  },
  {
    id: 'B06',
    stacks: [1000, 10, 1000, 1000],
    actions: [check, allIn],
    actors: [1, 2],
    lines: [0, 10],
    full: [20, 20],
    paid: [0, 10],
  },
  {
    id: 'B07',
    stacks: [1000, 10, 1000, 1000],
    actions: [check, allIn, call, fold],
    actors: [1, 2, 3, 0],
    lines: [0, 10, 10, 10],
    full: [20, 20, 20, 20],
    paid: [0, 10, 10, 0],
  },
];
const traces: unknown[] = [];
it('replays both original B03 and B12 histories from the frozen fixture', () => {
  for (const id of ['B03', 'B12'] as const) {
    let r = start([1000, 150, 1000, 1000]);
    for (const step of loadBettingHistory(id)) {
      expect(r.actorSeatId).toBe(step.seatId);
      r = play(r, step.action).state;
      if (step.resolvedRaiseTo !== null) expect(r.currentBet).toBe(step.resolvedRaiseTo);
    }
    expect(r.players).toEqual(loadBettingRoundFixture(id).round.players);
    expect(r.actorSeatId).toBe(0);
  }
});
for (const row of trajectories)
  it(row.id + ' maintains rights through a real action history', () => {
    let r = start(row.stacks);
    const steps: unknown[] = [];
    for (const [i, action] of row.actions.entries()) {
      const actor = r.actorSeatId,
        result = play(r, action);
      r = result.state;
      expect(r.actorSeatId).toBe(row.actors[i]);
      expect(r.currentBet).toBe(row.lines[i]);
      expect(r.lastFullRaiseSize).toBe(row.full[i]);
      expect(result.effect.paidAmount).toBe(row.paid[i]);
      steps.push({
        submittedSeatId: actor,
        action,
        paid: result.effect.paidAmount,
        state: r,
        outcome: result.outcome,
      });
    }
    const original = loadBettingRoundFixture(row.id),
      legal = getLegalActions(r, r.actorSeatId!);
    expect(r.actorSeatId).toBe(original.round.actorSeatId);
    expect(r.currentBet).toBe(original.round.currentBet);
    expect(r.lastFullRaiseSize).toBe(original.round.lastFullRaiseSize);
    for (const expected of original.round.players) {
      const p = r.players.find((p) => p.seatId === expected.seatId)!;
      expect({ ...p, lastActedAtBet: undefined }).toEqual({
        ...expected,
        lastActedAtBet: undefined,
      });
      if (!p.folded) expect(p.lastActedAtBet).toBe(expected.lastActedAtBet);
    }
    expect(legal.allowed).toEqual(original.expected.legalActions);
    expect(legal.callAmount).toBe(original.expected.callAmount);
    expect(legal.minRaiseTo).toBe(original.expected.minRaiseTo);
    if (original.expected.raiseRightReopened !== undefined)
      expect(hasRaiseRight(r, r.actorSeatId!)).toBe(original.expected.raiseRightReopened);
    expect(legal.allowed.includes('raise')).toBe(original.expected.canRaise);
    if (original.expected.responsiveOpponentSeatIds !== undefined)
      expect(getResponsiveOpponentSeatIds(r, r.actorSeatId!)).toEqual(
        original.expected.responsiveOpponentSeatIds,
      );
    if (row.id === 'B06')
      expect(applyBettingAction(r, 2, { type: 'raise', raiseTo: 20 })).toMatchObject({
        ok: false,
        reason: 'ILLEGAL_AMOUNT',
        state: r,
      });
    if (row.id === 'B03') {
      const b12 = loadBettingRoundFixture('B12'),
        before = structuredClone(r),
        bad = applyBettingAction(r, 0, b12.when.action);
      expect(bad).toMatchObject({ ok: false, reason: b12.expected.reason });
      expect(bad.state).toBe(r);
      expect(r).toEqual(before);
      const snap = applyBettingAction(b12.round, 0, b12.when.action);
      expect(snap.ok).toBe(false);
      expect(snap.state).toBe(b12.round);
    }
    traces.push({ id: row.id, steps });
    const stage = process.env.ORBIT_VERIFY_STAGE,
      prefix = stage === 'w09' || stage === 'w10' ? stage : 'scratch';
    writeFileSync(
      new URL(`../../docs/verification/${prefix}-betting-traces.json`, import.meta.url),
      JSON.stringify(
        {
          scope: 'component action histories, no dealing or payouts',
          foldedHistoryNote:
            'B07 frozen snapshot has null for folded D; real fold records currentBet=10 per W09 contract',
          traces,
        },
        null,
        2,
      ) + '\n',
    );
  });
for (const id of ['B03', 'B04', 'B05', 'B06', 'B07'])
  it(id + ' also reads original snapshot expectations', () => {
    const { round, expected } = loadBettingRoundFixture(id),
      legal = getLegalActions(round, round.actorSeatId!);
    expect(legal.allowed).toEqual(expected.legalActions);
    expect(legal.minRaiseTo).toEqual(expected.minRaiseTo);
    expect(legal.callAmount).toBe(expected.callAmount);
    if (expected.raiseRightReopened !== undefined)
      expect(hasRaiseRight(round, round.actorSeatId!)).toBe(expected.raiseRightReopened);
  });
it('records the newly faced line after a real call and charges once', () => {
  const round = loadBettingRoundFixture('B03').round,
    result = play(round, call);
  expect(result.effect.paidAmount).toBe(50);
  expect(result.state.players[0]?.lastActedAtBet).toBe(150);
  expect(round.players[0]?.lastActedAtBet).toBe(100);
  expect(result.outcome).toBe('streetComplete');
});
it('O05 preserves the actual big-blind option after everyone calls', () => {
  const positions = resolvePositions([0, 1, 2], 0),
    blind = postBlinds(
      [0, 1, 2].map((s) => ({ seatId: seat(s), stack: 2000 })),
      positions,
    );
  let r = beginBettingRound({
    street: 'preflop',
    bigBlind: 20,
    players: blind.players,
    actionOrder: positions.preflopOrder,
  });
  expect(r.actorSeatId).toBe(0);
  r = play(r, call).state;
  expect(r.actorSeatId).toBe(1);
  r = play(r, call).state;
  const original = loadBettingRoundFixture('O05');
  expect(r.actorSeatId).toBe(original.expected.actorSeatId);
  expect(getRoundOutcome(r) === 'streetComplete').toBe(original.expected.streetFinished);
  expect(r.pendingSeatIds).toEqual([2]);
  expect(getLegalActions(r, 2).allowed).toEqual(original.expected.legalActions);
  const end = play(r, check);
  expect(end.outcome).toBe('streetComplete');
  expect(end.state.actorSeatId).toBeNull();
  expect(end.state.pendingSeatIds).toEqual([]);
});
it('resets only street contributions and action baselines on a new postflop round', () => {
  const prior = start([1000, 1000]);
  const players = prior.players.map((p) => ({
      ...p,
      streetCommitted: 40,
      handCommitted: 100,
      lastActedAtBet: 40,
    })),
    copy = structuredClone(players);
  const r = beginBettingRound({ street: 'turn', bigBlind: 20, players, actionOrder: [1, 0] });
  expect(players).toEqual(copy);
  expect(r.currentBet).toBe(0);
  expect(r.players.map((p) => [p.streetCommitted, p.handCommitted, p.lastActedAtBet])).toEqual([
    [0, 100, null],
    [0, 100, null],
  ]);
  expect(r.actorSeatId).toBe(1);
  expect(Object.isFrozen(r.players[0])).toBe(true);
});
it('finishes normal checks and reschedules everyone after a full raise', () => {
  let r = start([1000, 1000, 1000]);
  r = play(r, check).state;
  r = play(r, check).state;
  expect(play(r, check).outcome).toBe('streetComplete');
  r = start([1000, 1000, 1000]);
  r = play(r, bet100).state;
  r = play(r, call).state;
  r = play(r, { type: 'raise', raiseTo: 300 }).state;
  expect(r.lastFullRaiseSize).toBe(200);
  expect(r.pendingSeatIds).toEqual([0, 1]);
  expect(getLegalActions(r, 0).minRaiseTo).toBe(500);
  r = play(r, call).state;
  expect(play(r, call).outcome).toBe('streetComplete');
});
it('requires the sole funded player to resolve debt before runout and never offers a free action', () => {
  const blind = postBlinds(
    [
      { seatId: 0, stack: 100 },
      { seatId: 1, stack: 7 },
    ],
    resolvePositions([0, 1], 0),
  );
  let r = beginBettingRound({
    street: 'preflop',
    bigBlind: 20,
    players: blind.players,
    actionOrder: [0, 1],
  });
  expect(r.currentBet).toBe(20);
  expect(r.pendingSeatIds).toEqual([0]);
  expect(getRoundOutcome(r)).toBe('continue');
  expect(getLegalActions(r, 0).allowed).toEqual(['fold', 'call']);
  const result = play(r, call);
  expect(result.outcome).toBe('runout');
  expect(result.state.pendingSeatIds).toEqual([]);
  r = start([100, 0]);
  expect(getRoundOutcome(r)).toBe('runout');
  expect(r.actorSeatId).toBeNull();
  r = start([0, 0]);
  expect(getRoundOutcome(r)).toBe('runout');
});
it('handles all-in completion, uncontested hands, and no-responsive-opponent rights', () => {
  let r = start([100, 100]);
  r = play(r, allIn).state;
  expect(play(r, allIn).outcome).toBe('runout');
  const result = play(start([100, 100]), fold);
  expect(result.outcome).toBe('uncontested');
  expect(result.state.actorSeatId).toBeNull();
  const original = loadBettingRoundFixture('B04').round;
  const p = original.players.map((p) => (p.seatId === 3 ? { ...p, folded: true } : p));
  r = { ...original, players: p, pendingSeatIds: [0] };
  expect(hasRaiseRight(r, 0)).toBe(true);
  expect(getLegalActions(r, 0).allowed).toEqual(['fold', 'call']);
  expect(play(r, call).outcome).toBe('runout');
});
it('rejects damaged queues and zero surviving players instead of inventing turns', () => {
  const base = start([100, 100]);
  expect(() =>
    getRoundOutcome({
      ...base,
      players: base.players.map((p) => ({ ...p, folded: true })),
      pendingSeatIds: [],
      actorSeatId: null,
    }),
  ).toThrow('INVALID_BETTING_STATE');
  expect(() => getRoundOutcome({ ...base, pendingSeatIds: [], actorSeatId: null })).toThrow(
    'INVALID_BETTING_STATE',
  );
  const owing: BettingPlayer[] = [
    { ...base.players[0]!, streetCommitted: 20, handCommitted: 20, lastActedAtBet: 20 },
    { ...base.players[1]!, lastActedAtBet: 0 },
  ];
  expect(() =>
    getRoundOutcome({
      ...base,
      currentBet: 20,
      players: owing,
      pendingSeatIds: [],
      actorSeatId: null,
    }),
  ).toThrow('INVALID_BETTING_STATE');
});
it('keeps the original complete round for invalid and wrong-turn actions', () => {
  const r = start([1000, 1000]),
    before = structuredClone(r);
  for (const [s, a] of [
    [1, bet100],
    [0, { type: 'raise', raiseTo: 40 }],
  ] as const) {
    const result = applyBettingAction(r, s, a);
    expect(result.ok).toBe(false);
    expect(result.state).toBe(r);
    expect(r).toEqual(before);
  }
});
