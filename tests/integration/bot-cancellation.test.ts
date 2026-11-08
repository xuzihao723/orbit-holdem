import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { threadId } from 'node:worker_threads';
import { WorkerPool } from '../../apps/server/src/bots/worker-pool.js';
import { royalCase } from '../helpers/equity-cases.js';
import { waitUntil } from '../helpers/reconnect-context.js';
const fixture = (name: string) =>
  new URL('../.generated-workers/' + name + '.worker.js', import.meta.url);
it('does not let an outcome observer mutate the estimate consumed by the scheduler', async () => {
  const pool = new WorkerPool({ size: 1, budgetMs: 1000 });
  let protectedValue = false;
  pool.onOutcome((record) => {
    if (record.outcome.kind === 'estimate')
      try {
        record.outcome.estimate.expectedReturn = 999;
      } catch {
        protectedValue = true;
      }
  });
  try {
    const result = await pool.submit(royalCase(), 77, 10).promise;
    expect(result.kind).toBe('estimate');
    if (result.kind !== 'estimate') throw Error(result.reason);
    expect(result.estimate.expectedReturn).toBe(100);
    expect(protectedValue).toBe(true);
  } finally {
    await pool.close();
  }
});
it('charges the same real budget to a job waiting behind a hung worker', async () => {
  const pool = new WorkerPool({
    size: 1,
    maxQueuedJobs: 2,
    budgetMs: 80,
    workerUrl: fixture('hang'),
  });
  try {
    await waitUntil(() => pool.stats.readyWorkers === 1);
    const first = pool.submit(royalCase()),
      second = pool.submit(royalCase()),
      result = await second.promise;
    expect(result).toMatchObject({ kind: 'fallback', reason: 'budget' });
    expect(result.queueMs).toBeGreaterThan(60);
    expect(result.elapsedMs).toBeLessThan(500);
    await first.promise;
    expect(pool.stats.settledJobs).toBe(2);
  } finally {
    await pool.close();
  }
});
it('rejects a real worker result bound to a different turn', async () => {
  const pool = new WorkerPool({
    size: 1,
    budgetMs: 500,
    workerUrl: fixture('late'),
    workerData: 'forged',
  });
  try {
    expect(await pool.submit(royalCase()).promise).toMatchObject({
      kind: 'fallback',
      reason: 'invalidMessage',
    });
  } finally {
    await pool.close();
  }
});
it.each([{ size: 0 }, { size: 5 }, { maxQueuedJobs: 33 }, { budgetMs: 0 }, { budgetMs: 1001 }])(
  'rejects invalid bounded pool options %j',
  (options) => expect(() => new WorkerPool(options)).toThrow(),
);
it('runs the actual compiled equity worker on another thread and reports actual samples', async () => {
  const pool = new WorkerPool({ size: 1, budgetMs: 1000 });
  try {
    const result = await pool.submit(royalCase(), 77, 10).promise;
    expect(result.kind).toBe('estimate');
    if (result.kind !== 'estimate') throw Error(result.reason);
    expect(result.threadId).toBeGreaterThan(0);
    expect(result.threadId).not.toBe(threadId);
    expect(result.estimate).toMatchObject({
      requestedSamples: 10,
      completedSamples: 10,
      weightedShare: 0.5,
      expectedReturn: 100,
    });
    expect(pool.stats.maxRunning).toBeLessThanOrEqual(1);
  } finally {
    await pool.close();
  }
  expect(pool.stats.activeWorkers).toBe(0);
});
it('settles a hung worker within the main-thread budget and closes without waiting for its loop', async () => {
  const pool = new WorkerPool({ size: 1, budgetMs: 80, workerUrl: fixture('hang') });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await waitUntil(() => pool.stats.readyWorkers === 1);
    const start = performance.now(),
      result = await Promise.race([
        pool.submit(royalCase()).promise,
        new Promise<never>(
          (_, reject) => (timer = setTimeout(() => reject(Error('BUDGET_GUARD_MISSING')), 1000)),
        ),
      ]);
    expect(result).toMatchObject({ kind: 'fallback', reason: 'budget' });
    expect(performance.now() - start).toBeLessThan(500);
  } finally {
    clearTimeout(timer);
    await pool.close();
  }
  expect(pool.stats.activeWorkers).toBe(0);
});
it('bounds the waiting queue, cancels a queued job once, and rejects submissions after closing', async () => {
  const pool = new WorkerPool({
    size: 1,
    maxQueuedJobs: 1,
    budgetMs: 200,
    workerUrl: fixture('hang'),
  });
  try {
    await waitUntil(() => pool.stats.readyWorkers === 1);
    const first = pool.submit(royalCase()),
      second = pool.submit(royalCase()),
      third = pool.submit(royalCase());
    expect(await third.promise).toMatchObject({ kind: 'fallback', reason: 'queueFull' });
    second.cancel();
    second.cancel();
    expect(await second.promise).toMatchObject({ kind: 'fallback', reason: 'cancelled' });
    await first.promise;
    expect(pool.stats.queuedJobs).toBe(0);
    expect(pool.stats.maxRunning).toBeLessThanOrEqual(1);
  } finally {
    await pool.close();
  }
  expect(await pool.submit(royalCase()).promise).toMatchObject({
    kind: 'fallback',
    reason: 'closed',
  });
  expect(pool.stats.submittedJobs).toBe(pool.stats.settledJobs);
});
it('contains real worker crashes and bounds replacement attempts', async () => {
  const pool = new WorkerPool({ size: 1, budgetMs: 200, workerUrl: fixture('crash') });
  try {
    for (let i = 0; i < 5; i++) {
      const result = await pool.submit(royalCase()).promise;
      expect(result.kind).toBe('fallback');
    }
    expect(pool.stats.workersCreated).toBeGreaterThan(0);
    expect(pool.stats.workersCreated).toBeLessThanOrEqual(3);
    expect(pool.stats.restarts).toBeLessThanOrEqual(2);
  } finally {
    await pool.close();
  }
});
it('discards unknown and duplicate results while settling only the matching worker job', async () => {
  const pool = new WorkerPool({ size: 1, budgetMs: 500, workerUrl: fixture('late') });
  try {
    const result = await pool.submit(royalCase(), 77, 1000).promise;
    expect(result.kind).toBe('estimate');
    await waitUntil(() => pool.stats.discardedMessages >= 2);
    expect(pool.stats.settledJobs).toBe(1);
  } finally {
    await pool.close();
  }
});
