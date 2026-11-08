import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import { writeFileSync } from 'node:fs';
import { lifecycleContext } from '../helpers/lifecycle-context.js';
import { waitUntil } from '../helpers/reconnect-context.js';
import { projectBotObservation } from '../../apps/server/src/bots/observation.js';
import { botActionCommand } from '../../apps/server/src/game/internal-command.js';
import type { WorkerOutcome } from '../../apps/server/src/bots/worker-pool.js';
function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>(
      (_, reject) => (timer = setTimeout(() => reject(Error('CROSS_ROOM_1000MS_GUARD')), 1000)),
    ),
  ]).finally(() => clearTimeout(timer));
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    at = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
  return { p50: at(0.5), p95: at(0.95), max: at(1) };
}
it('keeps 100 successful real commands and health queries responsive while two actual worker threads compute', async () => {
  const c = await lifecycleContext({
    players: 1,
    bots: 1,
    difficulty: 'standard',
    botOptions: { enabled: false },
    workerPoolOptions: { size: 2, budgetMs: 150 },
  });
  let stop = false;
  let pumps: Promise<void>[] = [];
  const outcomes: WorkerOutcome[] = [];
  try {
    await c.start();
    let h = c.room().hand!;
    expect(
      await c.command(c.humans[0]!.socket, 'game:action', {
        commandId: crypto.randomUUID(),
        roomId: c.roomId,
        handId: h.handId,
        turnId: h.turnId!,
        expectedVersion: h.handVersion,
        action: { type: 'call' },
      }),
    ).toMatchObject({ ok: true });
    const first = projectBotObservation(c.room(), c.room().participants[1]!.botId!)!;
    expect(await c.app.rooms.executeBotAction(botActionCommand(first, { type: 'check' }))).toBe(
      'applied',
    );
    const observation = projectBotObservation(c.room(), first.botId)!;
    expect(observation.phase).toBe('flop');
    const x = await c.guest('Other'),
      y = await c.guest('Other2'),
      made = await c.command(x.socket, 'room:create', {
        commandId: crypto.randomUUID(),
        capacity: 2,
        nickname: 'Other',
      });
    if (!made.ok) throw Error(made.code);
    const otherId = made.roomId;
    expect(
      await c.command(y.socket, 'room:join', {
        commandId: crypto.randomUUID(),
        roomCode: c.readRoom(otherId).row.roomCode,
        nickname: 'Other2',
      }),
    ).toMatchObject({ ok: true });
    const warm = await fetch(c.origin + '/health/live');
    await warm.arrayBuffer();
    const measure = async () => {
      const values: number[] = [];
      for (let i = 0; i < 100; i++) {
        await c.clock.advanceTo(c.clock.now() + 100, false);
        const start = performance.now(),
          [ack, health] = await bounded(
            Promise.all([
              c.command(x.socket, 'room:ready', {
                commandId: crypto.randomUUID(),
                roomId: otherId,
                expectedRoomVersion: c.readRoom(otherId).row.roomVersion,
                ready: i % 2 === 0,
              }),
              fetch(c.origin + '/health/live', { signal: AbortSignal.timeout(1000) }),
            ]),
          );
        expect(ack).toMatchObject({ ok: true });
        expect(health.status).toBe(200);
        await health.arrayBuffer();
        values.push(performance.now() - start);
      }
      return values;
    };
    const baseline = await measure(),
      pool = c.app.workerPool;
    await waitUntil(() => pool.stats.readyWorkers === 2);
    const compute = async (seed: number) => {
      while (!stop) {
        const result = await pool.submit(observation, seed++, 10000).promise;
        outcomes.push(result);
      }
    };
    pumps = [compute(77), compute(10077)];
    await waitUntil(() => pool.stats.runningJobs === 2);
    const loaded = await measure();
    stop = true;
    await Promise.all(pumps);
    const workerThreadIds = [
      ...new Set(
        outcomes.map((o) => o.threadId).filter((id): id is number => id !== null && id > 0),
      ),
    ];
    expect(workerThreadIds.length).toBe(2);
    expect(pool.stats.maxRunning).toBeLessThanOrEqual(2);
    expect(loaded).toHaveLength(100);
    expect(distribution(loaded).max).toBeLessThan(1000);
    writeFileSync(
      `docs/verification/${process.env.ORBIT_VERIFY_STAGE ?? 'scratch'}-responsiveness.json`,
      JSON.stringify(
        {
          date: '2026-11-01',
          node: process.version,
          os: platform() + ' ' + release(),
          cpu: cpus()[0]?.model,
          logicalCpus: cpus().length,
          successfulCommands: 100,
          healthQueries: 100,
          baseline: distribution(baseline),
          loaded: distribution(loaded),
          referenceP95Ms: 100,
          referencePassed: distribution(loaded).p95 < 100,
          singleRequestGuardMs: 1000,
          workerThreadIds,
          poolSize: 2,
          budgetMs: 150,
          workerOutcomes: outcomes,
          transportTestLimits: { connection: 1000, session: 1000, ip: 10000, windowMs: 1000 },
          businessClockAdvancePerCommand: 100,
          rateLimitedSamples: 0,
          credentialsIncluded: false,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    stop = true;
    await c.app.workerPool.close();
    await Promise.allSettled(pumps);
    await c.close();
  }
}, 30000);
