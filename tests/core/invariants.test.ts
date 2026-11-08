import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createHand, applyHandAction } from '../../packages/poker-core/src/state.js';
import { assertHandInvariants } from '../../packages/poker-core/src/invariants.js';
import type { HandState } from '../../packages/poker-core/src/hand-types.js';
import { handInput } from '../helpers/hand-scenarios.js';
import { passiveHand, stepHand } from '../helpers/hand-replay.js';
import { createDeck } from '../../packages/poker-core/src/cards.js';
import type { HandActionResult } from '../../packages/poker-core/src/hand-types.js';
import { invariantFixtures } from '../helpers/invariant-scenarios.js';
import {
  simulateLegalHands,
  simulateInvalidActions,
  replaySimulationFailure,
} from '../helpers/core-simulation.js';
import { invalidHandCase } from '../helpers/invalid-hand-cases.js';
it('detects a manufactured chip and every major corrupt state without repairing it', () => {
  const s = createHand(handInput('S02')).state;
  const cases: { state: HandState; code: string }[] = [
    {
      state: {
        ...s,
        players: s.players.map((p, i) => (i === 0 ? { ...p, stack: p.stack + 1 } : p)),
      },
      code: 'CHIPS_NOT_CONSERVED',
    },
    {
      state: { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, stack: -1 } : p)) },
      code: 'CHIPS_UNSAFE',
    },
    {
      state: {
        ...s,
        players: s.players.map((p, i) => (i === 0 ? { ...p, stack: Number.MAX_SAFE_INTEGER } : p)),
      },
      code: 'CHIPS_UNSAFE',
    },
    {
      state: {
        ...s,
        players: s.players.map((p, i) =>
          i === 0 ? { ...p, holeCards: [s.players[1]!.holeCards[0], p.holeCards[1]] as const } : p,
        ),
      },
      code: 'CARDS_INVALID',
    },
    { state: { ...s, deck: { ...s.deck, cursor: 52 } }, code: 'CARDS_INVALID' },
    { state: { ...s, phase: 'flop' }, code: 'PHASE_INVALID' },
    {
      state: { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, folded: true } : p)) },
      code: 'ACTOR_INVALID',
    },
    { state: { ...s, turnId: 'invalid' }, code: 'TURN_INVALID' },
  ];
  expect(() => assertHandInvariants(s)).not.toThrow();
  for (const row of cases) {
    const before = structuredClone(row.state);
    expect(() => assertHandInvariants(row.state)).toThrow(row.code);
    expect(row.state).toEqual(before);
  }
  const end = passiveHand(handInput('S02')).state;
  expect(() => assertHandInvariants(end)).not.toThrow();
  expect(() =>
    assertHandInvariants({
      ...end,
      players: end.players.map((p, i) =>
        i === 0 ? { ...p, stack: p.stack - 1, handCommitted: 1 } : p,
      ),
    }),
  ).toThrow('SETTLEMENT_INVALID');
});
const config = invariantFixtures();
it('I01 completes the original thousand legal hands checking every intermediate state', () => {
  const result = simulateLegalHands(config.legal);
  expect(result.completed).toBe(config.expectedLegal.completedHands);
  expect(result.failure).toBeNull();
  expect(result.failureCount).toBe(0);
  expect(result.maximumActionsObserved).toBeLessThanOrEqual(config.legal.maxActionsPerHand);
  expect(Object.keys(result.playerCountCoverage).sort()).toEqual(['2', '3', '4']);
  expect(result.outcomes.showdown).toBeGreaterThan(0);
  expect(result.outcomes.allOthersFolded).toBeGreaterThan(0);
  const stage = /^w(?:13|14|15|16|17|18|19|20)$/.test(process.env.ORBIT_VERIFY_STAGE ?? '')
    ? process.env.ORBIT_VERIFY_STAGE
    : 'scratch';
  writeFileSync(
    `docs/verification/${stage}-legal-simulation.json`,
    JSON.stringify(result, null, 2) + '\n',
  );
}, 120000);
it('I02 rejects the original thousand invalid actions with full-state identity preserved', () => {
  const result = simulateInvalidActions(config.invalid);
  expect(result.completed).toBe(config.expectedInvalid.rejectedCount);
  expect(result.failureCount).toBe(0);
  expect(result.failure).toBeNull();
  expect(Object.keys(result.classCoverage)).toEqual(config.invalid.classes);
  expect(Object.values(result.classCoverage)).toEqual([
    112, 111, 111, 111, 111, 111, 111, 111, 111,
  ]);
  const stage = /^w(?:13|14|15|16|17|18|19|20)$/.test(process.env.ORBIT_VERIFY_STAGE ?? '')
    ? process.env.ORBIT_VERIFY_STAGE
    : 'scratch';
  writeFileSync(
    `docs/verification/${stage}-invalid-simulation.json`,
    JSON.stringify(result, null, 2) + '\n',
  );
}, 120000);
it('uses reachable and correctly classified invalid contexts rather than only wrong actors', () => {
  for (const kind of config.invalid.classes) {
    const sample = invalidHandCase(kind, 0);
    assertHandInvariants(sample.state);
    const r = applyHandAction(sample.state, sample.request);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('ACCEPTED');
    expect(r.reason).toBe(
      kind === 'wrongActor'
        ? 'NOT_YOUR_TURN'
        : kind === 'checkWhileFacingBet' || kind === 'raiseWithoutReopening'
          ? 'ILLEGAL_ACTION'
          : 'ILLEGAL_AMOUNT',
    );
    expect(r.state).toBe(sample.state);
  }
});
it('reproduces a seeded trace digest and reports the earliest failing prefix at an action limit', () => {
  const input = { ...config.legal, hands: 18 };
  expect(simulateLegalHands(input)).toEqual(simulateLegalHands(input));
  const failed = simulateLegalHands({ ...config.legal, hands: 1, maxActionsPerHand: 0 });
  expect(failed.completed).toBe(0);
  expect(failed.failureCount).toBe(1);
  expect(failed.failure).not.toBeNull();
  if (!failed.failure) throw new Error('NO_FAILURE');
  expect(replaySimulationFailure(failed.failure)).toBe('ACTION_LIMIT');
});
it('retains a replayable diagnostic even when initial hand construction rejects', () => {
  const report = simulateLegalHands({ ...config.legal, hands: 1, initialStackPerSeat: 0 });
  expect(report.completed).toBe(0);
  expect(report.failureCount).toBe(1);
  expect(report.failure?.trace).toEqual([]);
  if (!report.failure) throw new Error('NO_FAILURE');
  expect(replaySimulationFailure(report.failure)).toBe(report.failure.reason);
});
it('independently detects stolen per-seat balances, unequal splits and clockwise odd-chip theft', () => {
  const s = passiveHand(handInput('S02')).state;
  const stolen = {
    ...s,
    players: s.players.map((p, i) => ({ ...p, stack: p.stack + (i === 0 ? 1 : -1) })),
    result: {
      ...s.result!,
      settlement: {
        ...s.result!.settlement,
        finalBalances: s.result!.settlement.finalBalances.map((p, i) => ({
          ...p,
          stack: p.stack + (i === 0 ? 1 : -1),
        })),
      },
    },
  };
  expect(() => assertHandInvariants(stolen)).toThrow('SETTLEMENT_INVALID');
  const split = {
    ...s,
    result: {
      ...s.result!,
      settlement: {
        ...s.result!.settlement,
        plan: {
          ...s.result!.settlement.plan,
          pots: s.result!.settlement.plan.pots.map((p) => ({
            ...p,
            allocations: p.allocations.map((a, i) => ({
              ...a,
              amount: a.amount + (i === 0 ? 1 : -1),
            })),
          })),
        },
      },
    },
  };
  expect(() => assertHandInvariants(split)).toThrow('SETTLEMENT_INVALID');
  const prefix = [
    'AS',
    'AC',
    'QS',
    'AH',
    'AD',
    'JH',
    '2S',
    '2H',
    '3D',
    '4C',
    '3S',
    '9S',
    '4S',
    'KD',
  ] as const;
  const initial = createHand({
    handId: 'odd',
    dealerSeatId: 2,
    deck: [...prefix, ...createDeck().filter((c) => !prefix.some((p) => p === c))],
    players: [0, 1, 2].map((seatId) => ({
      seatId: seatId as 0 | 1 | 2,
      participantId: 'p' + seatId,
      stack: 1,
    })),
  }).state;
  const end = stepHand(initial, { type: 'allIn' }).state;
  expect(end.players.map((p) => p.stack)).toEqual([2, 1, 0]);
  assertHandInvariants(end);
  const wrong = {
    ...end,
    players: end.players.map((p) => ({ ...p, stack: p.seatId === 0 ? 1 : p.seatId === 1 ? 2 : 0 })),
    result: {
      ...end.result!,
      settlement: {
        ...end.result!.settlement,
        finalBalances: end.result!.settlement.finalBalances.map((p) => ({
          ...p,
          stack: p.seatId === 0 ? 1 : p.seatId === 1 ? 2 : 0,
        })),
        plan: {
          ...end.result!.settlement.plan,
          pots: end.result!.settlement.plan.pots.map((p) => ({
            ...p,
            allocations: p.allocations.map((a) => ({ ...a, amount: a.seatId === 0 ? 1 : 2 })),
          })),
        },
      },
    },
  };
  expect(() => assertHandInvariants(wrong)).toThrow('SETTLEMENT_INVALID');
});
it('replays invalid acceptance, rejection mutation and legal-prefix failures in their own mode', () => {
  const acceptBad = (s: HandState, q: Parameters<typeof applyHandAction>[1]): HandActionResult => {
    const r = applyHandAction(s, q);
    return r.ok ? r : { ok: true, state: r.state, events: r.events };
  };
  const mutateReject = (
    s: HandState,
    q: Parameters<typeof applyHandAction>[1],
  ): HandActionResult => {
    const r = applyHandAction(s, q);
    return r.ok ? r : { ...r, state: { ...s, handVersion: s.handVersion + 1 } };
  };
  const rejectPrefix = (
    s: HandState,
    q: Parameters<typeof applyHandAction>[1],
  ): HandActionResult => {
    if (q.action && typeof q.action === 'object' && 'type' in q.action && q.action.type === 'call')
      return { ok: false, reason: 'ILLEGAL_ACTION', state: s, events: [] };
    return applyHandAction(s, q);
  };
  for (const [transition, samples] of [
    [acceptBad, 1],
    [mutateReject, 1],
    [rejectPrefix, 7],
  ] as const) {
    const r = simulateInvalidActions({ ...config.invalid, samples }, transition);
    expect(r.failureCount).toBe(1);
    expect(r.failure).not.toBeNull();
    if (!r.failure) throw new Error('NO_FAILURE');
    expect(replaySimulationFailure(r.failure, transition)).toBe(r.failure.reason);
  }
});
