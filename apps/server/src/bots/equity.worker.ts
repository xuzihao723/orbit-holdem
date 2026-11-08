import { parentPort, threadId } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { parseWorkerJob } from './worker-messages.js';
import { estimateEquity } from './equity.js';
parentPort?.postMessage({ kind: 'ready', threadId });
parentPort?.on('message', (value: unknown) => {
  const job = parseWorkerJob(value),
    flag = new Int32Array(job.cancellation),
    deadline = performance.now() + Math.max(0, job.remainingMs - 5);
  let seed = job.seed;
  try {
    const estimate = estimateEquity(
      job.observation,
      {
        next: () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 0x100000000;
        },
      },
      job.requestedSamples,
      {
        shouldStop: () => Atomics.load(flag, 0) !== 0 || performance.now() >= deadline,
        reason: () => (Atomics.load(flag, 0) !== 0 ? 'cancelled' : 'budget'),
      },
    );
    parentPort!.postMessage({
      kind: 'result',
      jobId: job.jobId,
      binding: job.binding,
      threadId,
      estimate,
    });
  } catch {
    parentPort!.postMessage({
      kind: 'failure',
      jobId: job.jobId,
      binding: job.binding,
      threadId,
      reason: 'computeFailure',
    });
  }
});
