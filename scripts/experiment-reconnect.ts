import { createHash, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { cpus, platform, release, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { io, type Socket } from 'socket.io-client';
import { createDeck, shuffleDeck } from '@orbit/poker-core';
import type {
  Action,
  CommandAck,
  GameActionCommand,
  GuestResponse,
  HistoryResponse,
  MutatingCommandMap,
  MutatingEventName,
  PlayerView,
  ResumeResponse,
} from '@orbit/protocol';
import { createApplicationRuntime } from '../apps/server/dist/application-runtime.js';
import { createPokerServer } from '../apps/server/dist/create-server.js';
import { projectPlayerView } from '../apps/server/dist/game/player-view.js';
import { startFaultProxy, type FaultProxy } from '../tests/helpers/fault-proxy.mjs';
import { createTestRandom } from '../tests/helpers/test-random.js';
import {
  buildSchedule,
  conditions,
  debitCount,
  matchesRecovery,
  readSamples,
  recoveryWindowMs,
  summarizeSamples,
  writeSamples,
  type RecoveryState,
  type Sample,
  type Trial,
} from './lib/reconnect-experiment.js';

const webOrigin = 'http://127.0.0.1:5173';
const round = (ms: number) => Math.round(ms * 100) / 100;
const id = () => ({ commandId: randomUUID() });

async function connect(origin: string) {
  const socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 2500 });
  try {
    await new Promise<void>((done, reject) => {
      socket.once('connect', done);
      socket.once('connect_error', reject);
    });
    return socket;
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

async function guest(socket: Socket, nickname: string) {
  const reply: GuestResponse = await socket.timeout(2500).emitWithAck('session:guest', {
    requestId: randomUUID(),
    nickname,
  });
  if (!reply.ok) throw Error('GUEST_' + reply.code);
  return reply;
}

function send<K extends MutatingEventName>(
  socket: Socket,
  event: K,
  payload: MutatingCommandMap[K],
) {
  return new Promise<CommandAck>((done, reject) => {
    function receive(ack: CommandAck) {
      if (ack.commandId !== payload.commandId) return;
      clearTimeout(timer);
      socket.off('command:ack', receive);
      done(ack);
    }
    const timer = setTimeout(() => {
      socket.off('command:ack', receive);
      reject(Error('ACTION_ACK_TIMEOUT'));
    }, 2500);
    socket.on('command:ack', receive);
    socket.emit(event, payload);
  });
}

async function apply<K extends MutatingEventName>(
  socket: Socket,
  event: K,
  payload: MutatingCommandMap[K],
) {
  const ack = await send(socket, event, payload);
  if (!ack.ok) throw Error('SETUP_' + ack.code);
  return ack;
}

function readState(sessionId: string, view: PlayerView | null): RecoveryState | null {
  const player = view?.players.find((p) => p.participantId === view.self.participantId);
  if (!view || !player) return null;
  return {
    sessionId,
    participantId: view.self.participantId,
    serverEpoch: view.serverEpoch,
    roomId: view.roomId,
    roomVersion: view.roomVersion,
    handId: view.handId,
    handVersion: view.handVersion,
    actorSeatId: view.actorSeatId,
    turnId: view.turnId,
    stack: player.stack,
  };
}

async function runTrial(trial: Trial, buildId: string): Promise<Sample> {
  const runStartUtc = new Date().toISOString();
  const start = performance.now();
  const condition = conditions.find((c) => c.id === trial.condition)!;
  const directory = mkdtempSync(join(tmpdir(), 'orbit-reconnect-experiment-'));
  const sockets: Socket[] = [];
  let proxy: FaultProxy | undefined;
  let app: ReturnType<typeof createApplicationRuntime> | undefined;
  let server: ReturnType<typeof createPokerServer> | undefined;
  try {
    const deck = shuffleDeck(createDeck(), createTestRandom(trial.seed));
    const runtime = (app = createApplicationRuntime({
      databasePath: join(directory, 'trial.sqlite'),
      randomInt: () => 0,
      handDeck: () => deck,
    }));
    server = createPokerServer({ port: 0, application: runtime, webOrigin });
    const { origin } = await server.listen();
    proxy = await startFaultProxy({ target: origin, origin: webOrigin });
    proxy.setProfile(condition.profile);
    const proxyPort = Number(new URL(proxy.origin).port);
    const probe = await connect(proxy.origin);
    sockets.push(probe);
    const other = await connect(origin);
    sockets.push(other);
    const probeGuest = await guest(probe, '恢复探针');
    await guest(other, '对手');
    const rttStart = performance.now();
    const history: HistoryResponse = await probe.timeout(2500).emitWithAck('history:list', {
      requestId: randomUUID(),
      cursor: null,
    });
    const measuredRttMs = round(performance.now() - rttStart);
    if (!history.ok || (condition.profile === 'rtt300' && measuredRttMs < 280))
      throw Error('INVALID_RTT_CALIBRATION');
    const { roomId } = await apply(other, 'room:create', {
      ...id(),
      nickname: '对手',
      capacity: 2,
    });
    const room = () => runtime.rooms.store.get(roomId)!;
    const hand = () => room().hand!;
    const ownView = () => {
      const control = runtime.sessions.registry.getCurrent(probeGuest.sessionId);
      return control ? projectPlayerView(room(), runtime.sessions, control) : null;
    };
    let beforeView: PlayerView | null = null;
    probe.on('game:view', (view: PlayerView) => {
      beforeView = view;
    });
    await apply(probe, 'room:join', {
      ...id(),
      roomCode: room().row.roomCode,
      nickname: '恢复探针',
    });
    for (const socket of [other, probe])
      await apply(socket, 'room:ready', {
        ...id(),
        roomId,
        expectedRoomVersion: room().row.roomVersion,
        ready: true,
      });
    await apply(other, 'room:start', {
      ...id(),
      roomId,
      expectedRoomVersion: room().row.roomVersion,
    });
    const action = (move: Action): GameActionCommand => ({
      ...id(),
      roomId,
      handId: hand().handId,
      turnId: hand().turnId!,
      expectedVersion: hand().handVersion,
      action: move,
    });
    await apply(other, 'game:action', action({ type: 'call' }));
    await apply(probe, 'game:action', action({ type: 'check' }));
    if (hand().phase !== 'flop' || hand().betting?.actorSeatId !== 1)
      throw Error('INVALID_FLOP_SETUP');
    const original = action({ type: 'bet', raiseTo: 40 });
    const committed = await apply(probe, 'game:action', original);
    const waitForView = performance.now() + 1000;
    while ((beforeView as PlayerView | null)?.handVersion !== committed.appliedHandVersion) {
      if (performance.now() > waitForView) throw Error('PRE_OUTAGE_VIEW_MISSING');
      await delay(5);
    }
    let observed = readState(probeGuest.sessionId, beforeView);
    if (!observed || observed.actorSeatId !== 0) throw Error('INVALID_PRE_OUTAGE_VIEW');
    const preHandVersion = observed.handVersion;
    await proxy.close();
    proxy = undefined;
    const observedDisconnectDeadline = performance.now() + 1000;
    while (runtime.sessions.registry.getCurrent(probeGuest.sessionId)) {
      if (performance.now() > observedDisconnectDeadline) throw Error('OUTAGE_NOT_OBSERVED');
      await delay(5);
    }
    const outageAt = performance.now();
    await delay(condition.outageMs - 3000);
    const reply = await apply(other, 'game:action', action({ type: 'call' }));
    if (
      hand().phase !== 'turn' ||
      hand().betting?.actorSeatId !== 1 ||
      reply.appliedHandVersion === null
    )
      throw Error('INVALID_OFFLINE_ADVANCE');
    const serverHandVersion = reply.appliedHandVersion;
    const oldState = observed;
    await delay(Math.max(0, outageAt + condition.outageMs - performance.now()));
    proxy = await startFaultProxy({ port: proxyPort, target: origin, origin: webOrigin });
    proxy.setProfile(condition.profile);
    const restoredAt = performance.now();
    const end = restoredAt + recoveryWindowMs;
    if (room().turnClock!.deadline < Date.now() + recoveryWindowMs + 3000)
      throw Error('INVALID_RECOVERY_WINDOW');
    let recoveryMs: number | null = null;
    let extraDebitCount: number | null = null;
    let duplicateProbeStatus: Sample['duplicateProbeStatus'] = 'not_sent';
    let couldContinue = false;
    let failureReason = 'view_mismatch';
    let next: Socket | null = null;
    try {
      next = await connect(proxy.origin);
      sockets.push(next);
      const reply: ResumeResponse = await next.timeout(2500).emitWithAck('session:resume', {
        requestId: randomUUID(),
        resumeToken: probeGuest.resumeToken,
        roomId,
        lastSeenHandId: oldState.handId,
        lastSeenRoomVersion: oldState.roomVersion,
        lastSeenHandVersion: preHandVersion,
      });
      if (reply.ok && reply.outcome === 'seatRestored') {
        if (trial.arm === 'snapshot') observed = readState(reply.sessionId, reply.playerView);
        // The messages-only observer gets ordinary updates only after authentication.
        next.on('game:view', (view: PlayerView) => {
          if (view.handVersion > preHandVersion) observed = readState(reply.sessionId, view);
        });
        while (performance.now() <= end) {
          const expected = readState(probeGuest.sessionId, ownView());
          if (expected && matchesRecovery(observed, expected)) {
            recoveryMs = round(performance.now() - restoredAt);
            break;
          }
          await delay(20);
        }
      } else failureReason = 'seat_not_restored';
    } catch {
      failureReason = 'reconnect_error';
    }
    const clientHandVersion = observed?.handVersion ?? null;
    if (recoveryMs !== null && next) {
      const stack = () => hand().players.find((p) => p.seatId === 1)!.stack;
      const previous = stack();
      const previousVersion = hand().handVersion;
      try {
        const duplicate = await send(next, 'game:action', original);
        duplicateProbeStatus = !duplicate.ok
          ? 'rejected'
          : duplicate.duplicate
            ? 'duplicate'
            : 'applied';
      } catch {
        duplicateProbeStatus = 'timeout';
      }
      extraDebitCount = debitCount(previous, stack());
      if (extraDebitCount !== 0) failureReason = 'extra_debit';
      else if (duplicateProbeStatus !== 'duplicate' || hand().handVersion !== previousVersion)
        failureReason = 'duplicate_receipt_failed';
      else {
        try {
          const ack = await send(next, 'game:action', action({ type: 'check' }));
          couldContinue = ack.ok && !ack.duplicate && hand().handVersion > previousVersion;
        } catch {
          couldContinue = false;
        }
        failureReason = couldContinue ? '' : 'next_action_failed';
      }
    }
    return {
      ...trial,
      buildId,
      runStartUtc,
      outageStartedMs: round(outageAt - start),
      networkRestoredMs: round(restoredAt - start),
      actualOutageMs: round(restoredAt - outageAt),
      measuredRttMs,
      preHandVersion,
      serverHandVersion,
      clientHandVersion,
      recovered: recoveryMs !== null,
      recoveryMs,
      extraDebitCount,
      duplicateProbeStatus,
      couldContinue,
      failureReason,
    };
  } finally {
    for (const socket of sockets) socket.disconnect();
    try {
      await proxy?.close();
    } finally {
      try {
        await server?.close();
        await app?.close();
      } finally {
        const target = resolve(directory);
        if (
          dirname(target) !== resolve(tmpdir()) ||
          !basename(target).startsWith('orbit-reconnect-experiment-')
        )
          throw Error('UNSAFE_EXPERIMENT_CLEANUP');
        rmSync(target, { recursive: true, force: true });
      }
    }
  }
}

function candidateId() {
  const hash = createHash('sha256');
  for (const root of ['apps/server/dist', 'packages/protocol/dist', 'packages/poker-core/dist']) {
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).replaceAll('\\', '/'))
      .sort();
    for (const file of files)
      hash.update(file).update('\0').update(readFileSync(file)).update('\0');
  }
  return hash.update(readFileSync('package-lock.json')).digest('hex');
}

async function main(args: string[]) {
  if (args.length === 2 && args[0] === '--summarize') {
    const rows = readSamples(readFileSync(args[1]!, 'utf8'));
    const expected = buildSchedule(rows.length / 6, rows[0]!.seed - 1);
    const rowKeys = new Set(rows.map((r) => [r.condition, r.pairIndex, r.arm, r.seed].join(':')));
    if (
      new Set(rows.map((r) => r.buildId)).size !== 1 ||
      expected.some((r) => !rowKeys.has([r.condition, r.pairIndex, r.arm, r.seed].join(':')))
    )
      throw Error('INCOMPLETE_PAIRED_SCHEDULE');
    console.log(JSON.stringify(summarizeSamples(rows), null, 2));
    return;
  }
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!,
      value = args[i + 1];
    if (!['--pairs', '--seed', '--output', '--lanes'].includes(key) || !value || options.has(key))
      throw Error('INVALID_EXPERIMENT_ARGUMENT');
    options.set(key, value);
  }
  const output = resolve(options.get('--output') ?? 'docs/experiments/reconnect/raw.csv');
  if (!/^[\w.-]+\.csv$/.test(basename(output))) throw Error('EXPECTED_CSV_OUTPUT');
  const partial = output + '.partial';
  const env = output.replace(/\.csv$/, '-environment.json');
  const invalid = output.replace(/\.csv$/, '-invalid.jsonl');
  if ([output, env, invalid].some(existsSync)) throw Error('EXPERIMENT_OUTPUT_EXISTS');
  const pairs = Number(options.get('--pairs') ?? '30');
  const seed = Number(options.get('--seed') ?? '20261106');
  const lanes = Number(options.get('--lanes') ?? '1');
  if (!Number.isSafeInteger(lanes) || lanes < 1 || lanes > 6) throw Error('INVALID_LANE_COUNT');
  const plan = buildSchedule(pairs, seed);
  const buildId = candidateId();
  writeFileSync(partial, writeSamples([]), { flag: 'wx' });
  writeFileSync(
    env,
    JSON.stringify(
      {
        buildId,
        seed,
        pairs,
        lanes,
        conditions,
        recoveryWindowMs,
        node: process.version,
        platform: platform(),
        osRelease: release(),
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        measurement: 'performance.now',
        portScope: 'loopback',
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  async function collect(trial: Trial) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await runTrial(trial, buildId);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const reason = /^[A-Z0-9_]+$/.test(message) ? message : 'INFRASTRUCTURE_ERROR';
        appendFileSync(invalid, JSON.stringify({ ...trial, attempt, reason }) + '\n');
        console.error(JSON.stringify({ ...trial, attempt, reason }));
      }
    }
    throw Error('TRIAL_INFRASTRUCTURE_ATTEMPTS_EXHAUSTED');
  }
  let completed = 0;
  for (const condition of conditions) {
    const runs = plan.filter((trial) => trial.condition === condition.id);
    for (let i = 0; i < runs.length; i += lanes * 2) {
      const batch = runs.slice(i, i + lanes * 2);
      const paired = await Promise.allSettled(
        Array.from({ length: batch.length / 2 }, async (_, lane) => {
          const first = await collect(batch[lane * 2]!);
          const second = await collect(batch[lane * 2 + 1]!);
          return [first, second];
        }),
      );
      for (const pair of paired) {
        if (pair.status === 'rejected') throw pair.reason;
        const csv = writeSamples(pair.value);
        appendFileSync(partial, csv.slice(csv.indexOf('\n') + 1));
        completed += pair.value.length;
      }
      console.log(
        JSON.stringify({ completed, total: plan.length, condition: condition.id, lanes }),
      );
    }
  }
  readSamples(readFileSync(partial, 'utf8'));
  linkSync(partial, output);
  unlinkSync(partial);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'EXPERIMENT_FAILED');
  process.exitCode = 1;
});
