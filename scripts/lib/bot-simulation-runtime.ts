import { randomUUID, createHash } from 'node:crypto';
import {
  mkdtempSync,
  rmSync,
  realpathSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import {
  createDeck,
  shuffleDeck,
  createHand,
  applyHandAction,
  assertHandInvariants,
  type CardId,
  type SeatId,
} from '@orbit/poker-core';
import type { Action } from '@orbit/protocol';
// The simulator deliberately loads the same JavaScript as production Node.
import { CommandHandler } from '../../apps/server/dist/game/command-handler.js';
import { openDatabase } from '../../apps/server/dist/persistence/db.js';
import { createSessionRuntime } from '../../apps/server/dist/sessions/runtime.js';
import { prepareHandStartCandidate } from '../../apps/server/dist/rooms/hand-start-candidate.js';
import { prepareBoundary } from '../../apps/server/dist/rooms/hand-boundary.js';
import { BotScheduler } from '../../apps/server/dist/bots/scheduler.js';
import { WorkerPool, type JobRecord } from '../../apps/server/dist/bots/worker-pool.js';
import { commandDigest } from '../../apps/server/dist/game/command-digest.js';
import type { RoomState } from '../../apps/server/dist/rooms/room-types.js';
import type { LedgerInsert, ReceiptInsert } from '../../apps/server/dist/persistence/rows.js';
import type { InternalBotAction } from '../../apps/server/dist/bots/bot-types.js';

export interface SimulationInput {
  seed: number;
  hands: number;
  output?: string;
}
interface DiagnosticOptions {
  profile?: 'basic' | 'standard';
  strongDeck?: boolean;
  faultAtHand?: number;
  maxAdvances?: number;
  resetAtHand?: number;
}
type Stacks = { participantId: string; seatId: SeatId; stack: number }[];
export interface SimulationHand {
  handIndex: number;
  profile: string;
  handId: string;
  deckSeed: number;
  deck: CardId[];
  dealerSeatId: SeatId;
  startingStacks: Stacks;
  finalStacks: Stacks;
  actions: { command: InternalBotAction; result: string }[];
  settlementCount: number;
  events: number;
  handVersion: number;
  reset: boolean;
  diagnostics?: { jobs: number; accepted: number; samples: number; fallbacks: number };
}
class SimulationClock {
  private time = 0;
  private id = 0;
  readonly tasks = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  setTimer = (callback: () => void, delay: number) => {
    const id = ++this.id;
    this.tasks.set(id, { at: this.time + delay, callback });
    return id;
  };
  clearTimer = (id: unknown) => {
    this.tasks.delete(Number(id));
  };
  step() {
    const next = [...this.tasks].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!next) throw Error('NO_PROGRESS_TIMER');
    this.tasks.delete(next[0]);
    this.time = next[1].at;
    next[1].callback();
  }
}
function derive(seed: number, domain: string) {
  return createHash('sha256')
    .update(String(seed) + ':' + domain)
    .digest()
    .readUInt32LE();
}
function random(seed: number) {
  let n = seed >>> 0;
  return {
    next() {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      return n / 0x100000000;
    },
  };
}
function receipt(s: RoomState, commandId: string, now: number): ReceiptInsert {
  const handId = s.hand?.handId ?? null,
    handVersion = s.hand?.handVersion ?? null;
  return {
    actorScope: 'system:' + s.row.roomId,
    commandId,
    event: 'internal:simulation',
    payloadHash: commandDigest('internal:simulation', { commandId }),
    roomId: s.row.roomId,
    appliedRoomVersion: s.row.roomVersion,
    handId,
    appliedHandVersion: handVersion,
    createdAt: now,
    result: {
      kind: 'internalApplied',
      roomId: s.row.roomId,
      roomVersion: s.row.roomVersion,
      handId,
      handVersion,
    },
  };
}
function ledger(
  s: RoomState,
  effects: readonly {
    participantId: string;
    matchId: string;
    type: LedgerInsert['type'];
    delta: number;
  }[],
  commandId: string,
  now: number,
): LedgerInsert[] {
  return effects.map((e) => ({
    ...e,
    entryId: randomUUID(),
    roomId: s.row.roomId,
    reason: 'isolated bot simulation',
    occurredAt: now,
    sourceActorScope: 'system:' + s.row.roomId,
    sourceCommandId: commandId,
    sourceSystemEventId: null,
  }));
}
class SimulationHandler extends CommandHandler {
  handIndex = 0;
  faultAtHand: number | undefined;
  failed: string | null = null;
  actions: SimulationHand['actions'] = [];
  pending = new Set<Promise<unknown>>();
  protected override boundaryCandidate(state: RoomState, now: number) {
    const x = prepareBoundary(state, this.sessions, now);
    if (state.participants.some((p) => p.sessionId !== null)) throw Error('SIMULATION_BOTS_ONLY');
    const playing =
      x.state.participants.filter(
        (p) => p.leftAt === null && p.admission === 'active' && p.stack > 0,
      ).length >= 2;
    return {
      ...x,
      state: {
        ...x.state,
        row: {
          ...x.state.row,
          status: playing ? ('betweenHands' as const) : ('matchFinished' as const),
          closedAt: null,
        },
      },
    };
  }
  override executeBotAction(command: InternalBotAction, isCurrent: () => boolean = () => true) {
    const actual =
      this.handIndex === this.faultAtHand && !this.failed
        ? { ...command, action: { type: 'raise' as const, raiseTo: -1 } }
        : command;
    const operation = super.executeBotAction(actual, isCurrent).then((result) => {
      this.actions.push({ command: structuredClone(actual), result });
      if (result !== 'applied') this.failed ??= 'BOT_ACTION_' + result;
      const h = this.store.get(command.roomId)?.hand;
      if (h) assertHandInvariants(h);
      return result;
    });
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }
  commitSimulation(
    before: RoomState | null,
    after: RoomState,
    effects: Parameters<typeof ledger>[1],
    id: string,
  ) {
    this.database.rooms.commitRoomChange({
      expectedRoomVersion: before?.row.roomVersion ?? null,
      room: after.row,
      participantWrites: after.participants,
      matchWrites: [after.match],
      ledger: ledger(after, effects, id, this.clock.now()),
      receipt: receipt(after, id, this.clock.now()),
    });
    this.store.replace(after);
    this.committed(before, after);
  }
  startSimulation(
    before: RoomState,
    deck: readonly CardId[],
    rng: ReturnType<typeof random>,
    reset: boolean,
  ) {
    const x = prepareHandStartCandidate(
        before,
        { now: this.clock.now(), serverEpoch: this.sessions.serverEpoch, reset },
        {
          handDeck: () => deck,
          randomInt: (min, max) => min + Math.floor(rng.next() * (max - min)),
        },
      ),
      id = 'simulation:start:' + x.hand.handId;
    this.database.hands.commitHandStart({
      expectedRoomVersion: before.row.roomVersion,
      room: x.state.row,
      participantWrites: x.state.participants,
      matchWrites: x.matchWrites,
      ledger: ledger(x.state, x.ledger, id, this.clock.now()),
      receipt: receipt(x.state, id, this.clock.now()),
      hand: x.hand,
      events: x.events,
    });
    this.store.replace(x.state);
    this.committed(before, x.state);
    return x.state;
  }
}
export function parseSimulationArgs(args: string[]): SimulationInput {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    if (
      !k ||
      !['--seed', '--hands', '--output'].includes(k) ||
      Object.hasOwn(values, k) ||
      args[i + 1] === undefined
    )
      throw Error('INVALID_SIMULATION_ARGUMENT');
    values[k] = args[i + 1]!;
  }
  const seed = Number(values['--seed'] ?? 20261031),
    hands = Number(values['--hands'] ?? 200),
    output = values['--output'] ?? 'docs/verification/bot-sim.json';
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(hands) || hands < 1 || hands > 200)
    throw Error('INVALID_SIMULATION_RANGE');
  const parent = realpathSync('docs/verification'),
    target = resolve(output);
  if (
    dirname(target) !== parent ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(basename(target)) ||
    existsSync(target) ||
    lstatSync('docs/verification').isSymbolicLink()
  )
    throw Error('OUTPUT_MUST_BE_NEW_VERIFICATION_JSON');
  return { seed, hands, output: target };
}
export function replaySimulationHand(trace: SimulationHand): Stacks {
  let h = createHand({
    handId: trace.handId,
    dealerSeatId: trace.dealerSeatId,
    deck: trace.deck,
    players: trace.startingStacks,
  }).state;
  for (const a of trace.actions) {
    if (a.result !== 'applied') break;
    const r = applyHandAction(h, {
      seatId: h.players.find((p) => p.participantId === a.command.participantId)!.seatId,
      turnId: h.turnId!,
      action: a.command.action,
    });
    if (!r.ok) throw Error('REPLAY_' + r.reason);
    h = r.state;
    assertHandInvariants(h);
  }
  return h.players.map((p) => ({
    participantId: p.participantId,
    seatId: p.seatId,
    stack: p.stack,
  }));
}
function fingerprints() {
  const result: Record<string, string> = {};
  for (const base of ['apps/server/src', 'packages/poker-core/src', 'scripts/lib']) {
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts'))
          result[p.replaceAll('\\', '/')] = createHash('sha256')
            .update(readFileSync(p))
            .digest('hex');
      }
    };
    walk(base);
  }
  return result;
}
export function simulationExitCode(report: {
  requestedHands: number;
  completedHands: number;
  standardAcceptedJobs: number;
  failure: unknown;
  resourcesClosed: boolean;
}) {
  return report.failure ||
    report.completedHands !== report.requestedHands ||
    !report.resourcesClosed ||
    (report.requestedHands === 200 && report.standardAcceptedJobs < 1)
    ? 1
    : 0;
}
export async function simulateBots(input: SimulationInput, diagnostic: DiagnosticOptions = {}) {
  const owned = mkdtempSync(join(tmpdir(), 'orbit-w28-')),
    dispose: (() => unknown | Promise<unknown>)[] = [];
  try {
    return await runSimulation(input, diagnostic, owned, (fn) => dispose.push(fn));
  } finally {
    // Cleanup is independent of report collection and executes even on setup/diagnostic errors.
    for (const close of dispose.reverse())
      try {
        await close();
      } catch {
        /* Continue closing remaining owned resources. */
      }
    const absolute = realpathSync(owned),
      parent = realpathSync(tmpdir());
    if (dirname(absolute) !== parent || !basename(absolute).startsWith('orbit-w28-'))
      throw Error('UNSAFE_TEMP_CLEANUP');
    rmSync(absolute, { recursive: true });
  }
}
async function runSimulation(
  input: SimulationInput,
  diagnostic: DiagnosticOptions,
  owned: string,
  register: (fn: () => unknown | Promise<unknown>) => void,
) {
  if (
    !Number.isSafeInteger(input.seed) ||
    !Number.isInteger(input.hands) ||
    input.hands < 1 ||
    input.hands > 200
  )
    throw Error('INVALID_SIMULATION_RANGE');
  const start = performance.now(),
    path = join(owned, 'simulation.sqlite'),
    clock = new SimulationClock(),
    db = openDatabase({ path, busyTimeoutMs: 1000 });
  register(() => db.close());
  db.migrate();
  const sessions = createSessionRuntime({
    database: db,
    now: clock.now,
    serverEpoch: 'simulation-epoch',
  });
  register(() => sessions.close());
  const rooms = new SimulationHandler(
      db,
      sessions,
      () => {},
      () => 'SMN234',
      {},
      clock,
    ),
    pool = new WorkerPool({ size: 2, budgetMs: 150 }),
    jobs: JobRecord[] = [];
  register(() => rooms.close());
  register(() => pool.close());
  const remove = pool.onOutcome((j) => jobs.push(j)),
    streams = new Map<string, ReturnType<typeof random>>();
  const bots = new BotScheduler(
    rooms,
    clock,
    {
      randomForBot: (id, kind) => {
        const key = id + ':' + kind;
        let r = streams.get(key);
        if (!r) {
          r = random(derive(input.seed, key));
          streams.set(key, r);
        }
        return r;
      },
    },
    () => pool,
  );
  register(() => bots.close());
  rooms.faultAtHand = diagnostic.faultAtHand;
  const report = {
    seed: input.seed,
    requestedHands: input.hands,
    completedHands: 0,
    illegalActions: 0,
    conservationFailures: 0,
    stuckHands: 0,
    standardJobs: 0,
    standardAcceptedJobs: 0,
    fallbackCount: 0,
    discardedStale: 0,
    cancelledJobs: 0,
    actualSamples: 0,
    unknownSampleJobs: 0,
    computeMs: { p50: 0, p95: 0, max: 0 },
    resets: 0,
    failure: null as null | {
      handIndex: number;
      turnId: string | null;
      reason: string;
      tracePath: string;
    },
    trace: [] as SimulationHand[],
    jobs,
    profiles: { basic: 0, standard: 0, mixed: 0 },
    profileMetrics: {} as Record<
      string,
      { completedHands: number; jobs: number; accepted: number; samples: number; fallbacks: number }
    >,
    resourcesClosed: false,
    elapsedMs: 0,
    environment: {
      node: process.version,
      os: platform() + ' ' + release(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
    },
    parameters: {
      size: 2,
      budgetMs: 150,
      requestedSamples: 1000,
      maxAdvances: diagnostic.maxAdvances ?? 200,
      watchdogMs: 300000,
      policy: 'project heuristic; uniform unknown hands; no strength claim',
    },
    sourceSha256: fingerprints(),
    resetLedger: [] as LedgerInsert[],
  };
  const roomId = 'simulation-room',
    now = clock.now(),
    matchId = randomUUID();
  const initial: RoomState = {
    publicEventSequence: 0,
    hand: null,
    previous: null,
    row: {
      roomId,
      roomCode: 'SMN234',
      capacity: 4,
      status: 'waiting',
      roomVersion: 1,
      serverEpoch: sessions.serverEpoch,
      hostParticipantId: null,
      matchId,
      currentHandId: null,
      createdAt: now,
      closedAt: null,
      resetProposal: null,
    },
    match: {
      matchId,
      roomId,
      status: 'active',
      lastBigBlindSeatId: null,
      startedAt: now,
      endedAt: null,
    },
    participants: ([0, 1, 2, 3] as const).map((seatId) => ({
      participantId: 'sim-participant-' + seatId,
      botId: 'sim-bot-' + seatId,
      roomId,
      sessionId: null,
      seatId,
      nickname: 'Bot ' + seatId,
      stack: 2000,
      admission: 'active',
      joinedAt: now,
      leftAt: null,
      ready: false,
      botDifficulty: 'basic',
    })),
  };
  let native: DatabaseSync | undefined;
  const flush = async () => {
    await rooms.queue.idle();
    await Promise.all([...rooms.pending]);
    await Promise.resolve();
  };
  try {
    rooms.commitSimulation(
      null,
      initial,
      initial.participants.map((p) => ({
        participantId: p.participantId,
        matchId,
        type: 'seat_grant',
        delta: 2000,
      })),
      'simulation:room:' + roomId,
    );
    native = new DatabaseSync(path, { readOnly: true });
    register(() => native?.close());
    for (let index = 1; index <= input.hands; index++) {
      const priorMetrics = bots.diagnostics;
      rooms.handIndex = index;
      rooms.actions = [];
      const profile =
        diagnostic.profile ?? (index <= 50 ? 'basic' : index <= 100 ? 'standard' : 'mixed');
      let before = rooms.store.get(roomId)!;
      const mode: RoomState = {
        ...before,
        participants: before.participants.map((p) => ({
          ...p,
          botDifficulty:
            profile === 'mixed' ? ((p.seatId + index) % 4 < 2 ? 'basic' : 'standard') : profile,
        })),
        row: { ...before.row, roomVersion: before.row.roomVersion + 1 },
      };
      rooms.commitSimulation(before, mode, [], 'simulation:mode:' + roomId + ':' + index);
      before = mode;
      const reset =
        before.participants.filter((p) => p.stack > 0 && p.admission === 'active').length < 2 ||
        diagnostic.resetAtHand === index;
      if (reset) report.resets++;
      const deckSeed = derive(input.seed, 'deck:' + index),
        deckRng = random(deckSeed);
      let deck = shuffleDeck(
        createDeck(),
        (min, max) => min + Math.floor(deckRng.next() * (max - min)),
      );
      if (diagnostic.strongDeck) {
        const prefix: CardId[] = ['KS', 'QS', 'JS', 'AS', 'KH', 'QH', 'JH', 'AH'];
        deck = [...prefix, ...deck.filter((c) => !prefix.includes(c))];
      }
      const made = rooms.startSimulation(
          before,
          deck,
          random(derive(input.seed, 'dealer:' + index)),
          reset,
        ),
        h = made.hand!;
      const trace: SimulationHand = {
        handIndex: index,
        profile,
        handId: h.handId,
        deckSeed,
        deck: [...deck],
        dealerSeatId: h.positions.dealerSeatId,
        startingStacks: h.players.map((p) => ({
          participantId: p.participantId,
          seatId: p.seatId,
          stack: p.startingStack,
        })),
        finalStacks: [],
        actions: rooms.actions,
        settlementCount: 0,
        events: 0,
        handVersion: 1,
        reset,
      };
      report.trace.push(trace);
      let advances = 0;
      while (rooms.store.get(roomId)!.hand!.phase !== 'settled') {
        if (rooms.failed) {
          report.illegalActions++;
          throw Error(rooms.failed);
        }
        if (performance.now() - start > 300000 || ++advances > (diagnostic.maxAdvances ?? 200)) {
          report.stuckHands++;
          throw Error('SIMULATION_ADVANCE_LIMIT');
        }
        while (pool.stats.pendingJobs > 0) {
          if (performance.now() - start > 300000) throw Error('SIMULATION_WATCHDOG');
          await new Promise((r) => setTimeout(r, 2));
        }
        await Promise.resolve();
        clock.step();
        await flush();
        if (rooms.store.get(roomId)!.row.status === 'pausedFault') throw Error('SIMULATION_PAUSED');
      }
      await flush();
      const final = rooms.store.get(roomId)!.hand!;
      assertHandInvariants(final);
      const stored = db.hands.readHand(final.handId)!,
        events = native
          .prepare('SELECT sequence FROM hand_events WHERE hand_id=? ORDER BY sequence')
          .all(final.handId);
      trace.finalStacks = final.players.map((p) => ({
        participantId: p.participantId,
        seatId: p.seatId,
        stack: p.stack,
      }));
      trace.settlementCount = final.settlementCount;
      trace.events = events.length;
      trace.handVersion = final.handVersion;
      const result = stored.result;
      if (
        final.settlementCount !== 1 ||
        stored.status !== 'settled' ||
        !result ||
        events.length !== final.eventSequence ||
        events.some((e, i) => e.sequence !== i + 1) ||
        trace.finalStacks.reduce((n, p) => n + p.stack, 0) !== final.initialChipTotal ||
        final.players.some((p) => p.handCommitted !== 0) ||
        JSON.stringify(replaySimulationHand(trace)) !== JSON.stringify(trace.finalStacks)
      ) {
        report.conservationFailures++;
        throw Error('SIMULATION_SETTLEMENT_MISMATCH');
      }
      for (const p of final.players) {
        const sql = native
          .prepare('SELECT stack FROM participants WHERE participant_id=?')
          .get(p.participantId);
        if (
          sql?.stack !== p.stack ||
          !result.finalStacks.some(
            (v) => v.participantId === p.participantId && v.stack === p.stack,
          )
        ) {
          report.conservationFailures++;
          throw Error('SIMULATION_SQL_BALANCE');
        }
      }
      const metrics = bots.diagnostics;
      trace.diagnostics = {
        jobs: metrics.workerJobs - priorMetrics.workerJobs,
        accepted: metrics.workerAcceptedActions - priorMetrics.workerAcceptedActions,
        samples: metrics.workerSamples - priorMetrics.workerSamples,
        fallbacks: metrics.workerFallbacks - priorMetrics.workerFallbacks,
      };
      const group = (report.profileMetrics[profile] ??= {
        completedHands: 0,
        jobs: 0,
        accepted: 0,
        samples: 0,
        fallbacks: 0,
      });
      group.completedHands++;
      for (const k of ['jobs', 'accepted', 'samples', 'fallbacks'] as const)
        group[k] += trace.diagnostics[k];
      report.completedHands++;
      report.profiles[profile]++;
    }
  } catch (error) {
    const s = rooms.store.get(roomId);
    report.failure = {
      handIndex: rooms.handIndex,
      turnId: s?.hand?.turnId ?? null,
      reason: error instanceof Error ? error.message : String(error),
      tracePath: input.output ?? 'inline:trace',
    };
  } finally {
    const d = bots.diagnostics;
    report.standardJobs = d.workerJobs;
    report.standardAcceptedJobs = d.workerAcceptedActions;
    report.actualSamples = d.workerSamples;
    report.fallbackCount = d.workerFallbacks;
    report.discardedStale = d.discardedStale;
    report.resetLedger = [...db.repositories.listLedger(roomId)].filter((e) =>
      e.type.startsWith('match_reset'),
    );
    bots.close();
    await pool.close();
    remove();
    await rooms.close();
    sessions.close();
    native?.close();
    db.close();
    report.cancelledJobs = jobs.filter(
      (j) => j.outcome.kind === 'fallback' && j.outcome.reason === 'cancelled',
    ).length;
    report.unknownSampleJobs = jobs.filter((j) => j.outcome.kind === 'fallback').length;
    const times = jobs.map((j) => j.outcome.elapsedMs).sort((a, b) => a - b),
      at = (p: number) => times[Math.max(0, Math.ceil(times.length * p) - 1)] ?? 0;
    report.computeMs = { p50: at(0.5), p95: at(0.95), max: at(1) };
    report.resourcesClosed = pool.stats.activeWorkers === 0 && clock.tasks.size === 0;
    const absolute = realpathSync(owned),
      parent = realpathSync(tmpdir());
    if (dirname(absolute) !== parent || !basename(absolute).startsWith('orbit-w28-'))
      throw Error('UNSAFE_TEMP_CLEANUP');
    // Outer finally removes the verified owned directory after all cleanup.
    report.elapsedMs = performance.now() - start;
  }
  if (
    input.hands === 200 &&
    report.completedHands === 200 &&
    report.standardAcceptedJobs === 0 &&
    !report.failure
  )
    report.failure = {
      handIndex: 200,
      turnId: null,
      reason: 'NO_ACCEPTED_STANDARD_DECISION',
      tracePath: input.output ?? 'inline:trace',
    };
  return report;
}
