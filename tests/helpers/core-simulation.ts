import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createDeck, shuffleDeck } from '../../packages/poker-core/src/index.js';
import {
  createHand,
  applyHandAction,
  advanceHand,
  getHandLegalActions,
} from '../../packages/poker-core/src/state.js';
import { assertHandInvariants } from '../../packages/poker-core/src/invariants.js';
import type {
  CreateHandInput,
  HandState,
  HandActionResult,
} from '../../packages/poker-core/src/hand-types.js';
import type { Action } from '../../packages/poker-core/src/betting-types.js';
import { createTestRandom } from './test-random.js';
import { invalidDefinition, type HandRequest } from './invalid-hand-cases.js';
import { INVALID_CLASSES, type InvalidClass } from './invariant-scenarios.js';
export interface CoreSimulationConfig {
  readonly seed: number;
  readonly hands: number;
  readonly maxActionsPerHand: number;
  readonly playerCounts: readonly (2 | 3 | 4)[];
  readonly initialStackPerSeat: number;
}
export interface InvalidSimulationConfig {
  readonly seed: number;
  readonly samples: number;
  readonly classes: readonly InvalidClass[];
}
export type HandTransition = (state: HandState, request: HandRequest) => HandActionResult;
export interface SimulationFailure {
  readonly mode: 'legal' | 'invalid';
  readonly invalidClass: InvalidClass | null;
  readonly faultStage: 'prefix' | 'request' | null;
  readonly seed: number;
  readonly index: number;
  readonly input: CreateHandInput;
  readonly trace: readonly HandRequest[];
  readonly reason: string;
  readonly stateSummary: unknown;
}
export interface SimulationSummary {
  readonly requested: number;
  readonly completed: number;
  readonly failureCount: number;
  readonly actionCount: number;
  readonly maximumActionsObserved: number;
  readonly seed: number;
  readonly failure: SimulationFailure | null;
  readonly traceDigest: string;
}
const reason = (e: unknown) => (e instanceof Error ? e.message : 'UNKNOWN_SIMULATION_FAILURE');
export function diagnosticJson(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_key, v: unknown) =>
        typeof v === 'number' && !Number.isFinite(v)
          ? { $jsNumber: String(v) }
          : v === undefined
            ? { $jsValue: 'undefined' }
            : v,
      2,
    ) + '\n'
  );
}
function decode(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(decode);
  const entries = Object.entries(v);
  if (entries.length === 1 && entries[0]![0] === '$jsNumber') {
    const n = entries[0]![1];
    return n === 'NaN' ? NaN : n === 'Infinity' ? Infinity : -Infinity;
  }
  if (entries.length === 1 && entries[0]![0] === '$jsValue') return undefined;
  return Object.fromEntries(entries.map(([k, x]) => [k, decode(x)]));
}
function summary(s: HandState) {
  return {
    phase: s.phase,
    version: s.handVersion,
    actor: s.betting?.actorSeatId ?? null,
    board: s.board,
    balances: s.players.map((p) => ({
      seatId: p.seatId,
      stack: p.stack,
      handCommitted: p.handCommitted,
    })),
  };
}
export function simulateLegalHands(config: CoreSimulationConfig) {
  if (
    !Number.isSafeInteger(config.hands) ||
    config.hands < 1 ||
    !Number.isSafeInteger(config.maxActionsPerHand) ||
    config.maxActionsPerHand < 0 ||
    !config.playerCounts.length
  )
    throw new Error('INVALID_SIMULATION_CONFIG');
  const rng = createTestRandom(config.seed),
    digest = createHash('sha256'),
    playerCountCoverage: Record<number, number> = {},
    outcomes = { showdown: 0, allOthersFolded: 0 };
  let completed = 0,
    actionCount = 0,
    maximumActionsObserved = 0,
    failure: SimulationFailure | null = null;
  for (let i = 0; i < config.hands; i++) {
    const count = config.playerCounts[i % config.playerCounts.length]!,
      seats = (
        count === 2 ? (i % 2 ? [0, 3] : [0, 1]) : count === 3 ? [0, 2, 3] : [0, 1, 2, 3]
      ) as (0 | 1 | 2 | 3)[];
    const input: CreateHandInput = {
        handId: 'sim-' + i,
        dealerSeatId: seats[rng(0, seats.length)]!,
        deck: shuffleDeck(createDeck(), rng),
        players: seats.map((seatId) => ({
          seatId,
          participantId: 'sim-' + i + '-' + seatId,
          stack: config.initialStackPerSeat,
        })),
      },
      trace: HandRequest[] = [];
    let state: HandState | null = null;
    try {
      state = createHand(input).state;
      assertHandInvariants(state);
      for (let n = 0; n < config.maxActionsPerHand && state.phase !== 'settled'; n++) {
        const actor = state.betting!.actorSeatId!,
          legal = getHandLegalActions(state, actor),
          type = legal.allowed[rng(0, legal.allowed.length)]!;
        const action: Action =
          type === 'bet' || type === 'raise'
            ? {
                type,
                raiseTo: [
                  legal.minRaiseTo!,
                  legal.minRaiseTo! + Math.floor((legal.maxRaiseTo! - legal.minRaiseTo!) / 2),
                  legal.maxRaiseTo!,
                ][rng(0, 3)]!,
              }
            : { type };
        const request = { seatId: actor, turnId: state.turnId!, action },
          before = structuredClone(state),
          version = state.handVersion,
          oldTurn = state.turnId;
        trace.push(request);
        const r = applyHandAction(state, request);
        actionCount++;
        if (!r.ok) throw new Error('UNEXPECTED_REJECTION:' + r.reason);
        if (!isDeepStrictEqual(state, before)) throw new Error('INPUT_MUTATED');
        state = r.state;
        if (
          state.handVersion !== version + 1 ||
          r.events.some((e) => e.handVersion !== r.state.handVersion) ||
          (state.turnId !== null && state.turnId === oldTurn)
        )
          throw new Error('REVISION_INVALID');
        assertHandInvariants(state);
      }
      maximumActionsObserved = Math.max(maximumActionsObserved, trace.length);
      if (state.phase !== 'settled') throw new Error('ACTION_LIMIT');
      const again = advanceHand(state);
      if (again.state !== state || again.events.length) throw new Error('TERMINAL_NOT_IDEMPOTENT');
      assertHandInvariants(again.state);
      outcomes[state.result!.reason]++;
      playerCountCoverage[count] = (playerCountCoverage[count] ?? 0) + 1;
      completed++;
      digest.update(JSON.stringify({ input, trace, final: summary(state) }));
    } catch (error) {
      failure = {
        mode: 'legal',
        invalidClass: null,
        faultStage: null,
        seed: config.seed,
        index: i,
        input,
        trace,
        reason: reason(error),
        stateSummary: state ? summary(state) : null,
      };
      break;
    }
  }
  return {
    requested: config.hands,
    completed,
    failureCount: failure ? 1 : 0,
    actionCount,
    maximumActionsObserved,
    seed: config.seed,
    failure,
    traceDigest: digest.digest('hex'),
    playerCountCoverage,
    outcomes,
  };
}
function expectedReason(kind: InvalidClass) {
  return kind === 'wrongActor'
    ? 'NOT_YOUR_TURN'
    : kind === 'checkWhileFacingBet' || kind === 'raiseWithoutReopening'
      ? 'ILLEGAL_ACTION'
      : 'ILLEGAL_AMOUNT';
}
function verifyRejection(
  state: HandState,
  before: HandState,
  result: HandActionResult,
  kind: InvalidClass,
): void {
  if (result.ok) throw new Error('INVALID_ACTION_ACCEPTED');
  if (result.state !== state || result.events.length || !isDeepStrictEqual(state, before))
    throw new Error('REJECTION_CHANGED_STATE');
  if (result.reason !== expectedReason(kind)) throw new Error('WRONG_REJECTION_REASON');
  assertHandInvariants(result.state);
}
export function simulateInvalidActions(
  config: InvalidSimulationConfig,
  transition: HandTransition = applyHandAction,
) {
  const rng = createTestRandom(config.seed),
    digest = createHash('sha256'),
    classCoverage = Object.fromEntries(config.classes.map((c) => [c, 0])) as Record<
      InvalidClass,
      number
    >;
  let completed = 0,
    failure: SimulationFailure | null = null;
  if (
    !Number.isSafeInteger(config.samples) ||
    config.samples < 1 ||
    JSON.stringify(config.classes) !== JSON.stringify(INVALID_CLASSES)
  )
    throw new Error('INVALID_SIMULATION_CONFIG');
  for (let i = 0; i < config.samples; i++) {
    const kind = config.classes[i % config.classes.length]!,
      definition = invalidDefinition(kind, rng(0, 100000)),
      trace: HandRequest[] = [];
    let state: HandState | null = null,
      faultStage: 'prefix' | 'request' = 'prefix';
    try {
      state = createHand(definition.input).state;
      assertHandInvariants(state);
      for (const action of definition.prefix) {
        const q = { seatId: state.betting!.actorSeatId!, turnId: state.turnId!, action },
          before = structuredClone(state);
        trace.push(q);
        const r = transition(state, q);
        if (!r.ok) throw new Error('UNEXPECTED_REJECTION:' + r.reason);
        if (!isDeepStrictEqual(state, before)) throw new Error('INPUT_MUTATED');
        state = r.state;
        assertHandInvariants(state);
      }
      faultStage = 'request';
      const request = definition.requestFor(state),
        before = structuredClone(state);
      trace.push(request);
      const result = transition(state, request);
      verifyRejection(state, before, result, kind);
      completed++;
      classCoverage[kind]++;
      digest.update(
        diagnosticJson({ kind, request, reason: result.ok ? 'accepted' : result.reason }),
      );
    } catch (error) {
      failure = {
        mode: 'invalid',
        invalidClass: kind,
        faultStage,
        seed: config.seed,
        index: i,
        input: definition.input,
        trace,
        reason: reason(error),
        stateSummary: state ? summary(state) : null,
      };
      break;
    }
  }
  return {
    requested: config.samples,
    completed,
    failureCount: failure ? 1 : 0,
    actionCount: completed,
    maximumActionsObserved: 1,
    seed: config.seed,
    failure,
    traceDigest: digest.digest('hex'),
    classCoverage,
  };
}
export function replaySimulationFailure(
  failure: SimulationFailure,
  transition: HandTransition = applyHandAction,
): string {
  try {
    let state = createHand(failure.input).state;
    assertHandInvariants(state);
    for (const [i, raw] of failure.trace.entries()) {
      const request = { ...raw, action: decode(raw.action) },
        before = structuredClone(state),
        result = transition(state, request);
      if (
        failure.mode === 'invalid' &&
        failure.faultStage === 'request' &&
        i === failure.trace.length - 1
      ) {
        if (!failure.invalidClass) throw new Error('MISSING_INVALID_CLASS');
        verifyRejection(state, before, result, failure.invalidClass);
        return 'NO_FAILURE';
      }
      if (!result.ok) throw new Error('UNEXPECTED_REJECTION:' + result.reason);
      if (!isDeepStrictEqual(state, before)) throw new Error('INPUT_MUTATED');
      state = result.state;
      assertHandInvariants(state);
    }
    if (failure.reason === 'ACTION_LIMIT' && state.phase !== 'settled') return 'ACTION_LIMIT';
    return 'NO_FAILURE';
  } catch (error) {
    return reason(error);
  }
}
