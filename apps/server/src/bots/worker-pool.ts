import type { BotObservation, EquityEstimate } from './bot-types.js';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { existsSync } from 'node:fs';
import {
  bindingFor,
  exact,
  parseWorkerJob,
  parseWorkerResult,
  sameBinding,
  validateWorkerObservation,
  type EquityWorkerJob,
  type BotJobBinding,
} from './worker-messages.js';
export interface WorkerPoolOptions {
  size?: number;
  maxQueuedJobs?: number;
  budgetMs?: number;
  workerUrl?: URL;
  workerData?: unknown;
}
export type FallbackReason =
  | 'budget'
  | 'queueFull'
  | 'workerError'
  | 'workerExit'
  | 'cancelled'
  | 'closed'
  | 'invalidMessage'
  | 'zeroSamples';
export type WorkerOutcome =
  | {
      kind: 'estimate';
      estimate: EquityEstimate;
      threadId: number;
      elapsedMs: number;
      queueMs: number;
    }
  | {
      kind: 'fallback';
      reason: FallbackReason;
      threadId: number | null;
      elapsedMs: number;
      queueMs: number;
    };
export interface JobHandle {
  jobId: string;
  promise: Promise<WorkerOutcome>;
  cancel(): void;
}
export interface JobRecord {
  binding: BotJobBinding;
  seed: number;
  requestedSamples: number;
  outcome: WorkerOutcome;
}
interface Slot {
  worker: Worker | null;
  ready: boolean;
  retiring: boolean;
  attempts: number;
  busy: Job | null;
}
interface Job {
  request: EquityWorkerJob;
  submitted: number;
  deadline: number;
  started: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  grace: ReturnType<typeof setTimeout> | null;
  slot: Slot | null;
  settled: boolean;
  resolve: (outcome: WorkerOutcome) => void;
}
export function validateWorkerPoolOptions(options: WorkerPoolOptions = {}) {
  const size = options.size ?? 2,
    maxQueuedJobs = options.maxQueuedJobs ?? 32,
    budgetMs = options.budgetMs ?? 150,
    local = new URL('./equity.worker.js', import.meta.url),
    workerUrl =
      options.workerUrl ??
      (existsSync(local) ? local : new URL('../../dist/bots/equity.worker.js', import.meta.url));
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > 4 ||
    !Number.isInteger(maxQueuedJobs) ||
    maxQueuedJobs < 0 ||
    maxQueuedJobs > 32 ||
    !Number.isInteger(budgetMs) ||
    budgetMs < 1 ||
    budgetMs > 1000 ||
    !(workerUrl instanceof URL) ||
    workerUrl.protocol !== 'file:' ||
    !workerUrl.pathname.endsWith('.js')
  )
    throw Error('INVALID_WORKER_POOL_OPTIONS');
  return Object.freeze({
    size,
    maxQueuedJobs,
    budgetMs,
    workerUrl,
    workerData: options.workerData,
  });
}
export class WorkerPool {
  readonly options: ReturnType<typeof validateWorkerPoolOptions>;
  private slots: Slot[];
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private closed = false;
  private closing: Promise<void> | undefined;
  private terminations = new Set<Promise<void>>();
  private listeners = new Set<(record: JobRecord) => void>();
  private history: JobRecord[] = [];
  private counts = {
    workersCreated: 0,
    maxRunning: 0,
    submittedJobs: 0,
    settledJobs: 0,
    discardedMessages: 0,
    restarts: 0,
    terminations: 0,
  };
  constructor(options: WorkerPoolOptions = {}) {
    this.options = validateWorkerPoolOptions(options);
    this.slots = Array.from({ length: this.options.size }, () => ({
      worker: null,
      ready: false,
      retiring: false,
      attempts: 0,
      busy: null,
    }));
    for (const slot of this.slots) this.spawn(slot);
  }
  get stats() {
    return Object.freeze({
      ...this.counts,
      activeWorkers: this.slots.filter((s) => s.worker !== null).length,
      readyWorkers: this.slots.filter((s) => s.ready && !s.retiring).length,
      runningJobs: this.slots.filter((s) => s.busy !== null).length,
      queuedJobs: this.queue.length,
      pendingJobs: this.jobs.size,
      closed: this.closed,
    });
  }
  get records() {
    return [...this.history];
  }
  onOutcome(listener: (record: JobRecord) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private spawn(slot: Slot) {
    if (this.closed || slot.attempts >= 3) return;
    slot.attempts++;
    if (slot.attempts > 1) this.counts.restarts++;
    try {
      const worker = new Worker(this.options.workerUrl, {
        execArgv: [],
        workerData: this.options.workerData,
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
      slot.worker = worker;
      slot.ready = false;
      slot.retiring = false;
      this.counts.workersCreated++;
      worker.on('message', (value: unknown) => this.message(slot, worker, value));
      worker.on('error', () => {
        if (slot.worker === worker && !slot.retiring) this.retire(slot, 'workerError');
      });
      worker.on('exit', () => {
        if (slot.worker === worker && !slot.retiring) this.retire(slot, 'workerExit');
      });
    } catch {
      slot.worker = null;
      slot.ready = false;
      if (slot.attempts < 3) this.spawn(slot);
    }
  }
  private retire(slot: Slot, reason: FallbackReason) {
    if (slot.retiring) return;
    slot.retiring = true;
    slot.ready = false;
    const worker = slot.worker,
      job = slot.busy;
    if (job) {
      this.fallback(job, reason);
      this.clearGrace(job);
      slot.busy = null;
    }
    if (!worker) {
      slot.retiring = false;
      return;
    }
    this.counts.terminations++;
    let termination: Promise<void>;
    termination = worker
      .terminate()
      .then(() => {
        if (slot.worker === worker) slot.worker = null;
        slot.retiring = false;
        if (!this.closed) this.spawn(slot);
      })
      .catch(() => {
        slot.worker = null;
        slot.retiring = false;
      })
      .finally(() => {
        this.terminations.delete(termination);
        this.pump();
      });
    this.terminations.add(termination);
  }
  private clearGrace(job: Job) {
    if (job.grace !== null) {
      clearTimeout(job.grace);
      job.grace = null;
    }
  }
  private timing(job: Job) {
    const elapsedMs = Math.max(0, performance.now() - job.submitted);
    return {
      elapsedMs,
      queueMs: job.started === null ? elapsedMs : Math.max(0, job.started - job.submitted),
    };
  }
  private finish(job: Job, outcome: WorkerOutcome) {
    if (job.settled) return;
    outcome =
      outcome.kind === 'estimate'
        ? Object.freeze({ ...outcome, estimate: Object.freeze({ ...outcome.estimate }) })
        : Object.freeze({ ...outcome });
    job.settled = true;
    if (job.timer !== null) clearTimeout(job.timer);
    this.jobs.delete(job.request.jobId);
    this.queue = this.queue.filter((j) => j !== job);
    this.counts.settledJobs++;
    if (outcome.kind === 'fallback') Atomics.store(new Int32Array(job.request.cancellation), 0, 1);
    const record = Object.freeze({
      binding: Object.freeze({ ...job.request.binding }),
      seed: job.request.seed,
      requestedSamples: job.request.requestedSamples,
      outcome,
    });
    this.history.push(record);
    if (this.history.length > 128) this.history.shift();
    for (const listener of this.listeners) {
      try {
        listener(record);
      } catch {
        /* Telemetry cannot change the result. */
      }
    }
    job.resolve(outcome);
  }
  private fallback(job: Job, reason: FallbackReason) {
    this.finish(job, {
      kind: 'fallback',
      reason,
      threadId: job.slot?.worker?.threadId ?? null,
      ...this.timing(job),
    });
  }
  private stop(job: Job, reason: 'cancelled' | 'budget') {
    if (job.settled) return;
    this.fallback(job, reason);
    const slot = job.slot;
    if (slot?.busy === job) {
      job.grace = setTimeout(() => {
        job.grace = null;
        if (slot.busy === job) this.retire(slot, reason);
      }, 25);
    }
    this.pump();
  }
  submit(observation: BotObservation, seed = 77, requestedSamples = 1000): JobHandle {
    const submitted = performance.now(),
      snapshot = structuredClone(validateWorkerObservation(observation)),
      jobId = randomUUID(),
      request = parseWorkerJob({
        kind: 'estimate',
        jobId,
        binding: bindingFor(jobId, snapshot),
        observation: snapshot,
        seed,
        requestedSamples,
        remainingMs: this.options.budgetMs,
        cancellation: new SharedArrayBuffer(4),
      });
    let resolve!: (outcome: WorkerOutcome) => void;
    const promise = new Promise<WorkerOutcome>((r) => (resolve = r)),
      job: Job = {
        request,
        submitted,
        deadline: submitted + this.options.budgetMs,
        started: null,
        timer: null,
        grace: null,
        slot: null,
        settled: false,
        resolve,
      };
    this.jobs.set(jobId, job);
    this.counts.submittedJobs++;
    const handle: JobHandle = { jobId, promise, cancel: () => this.stop(job, 'cancelled') };
    if (this.closed) {
      this.fallback(job, 'closed');
      return handle;
    }
    job.timer = setTimeout(
      () => this.stop(job, 'budget'),
      Math.max(0, job.deadline - performance.now()),
    );
    const idle = this.slots.some((s) => s.ready && !s.retiring && s.busy === null);
    if (this.queue.length >= this.options.maxQueuedJobs && !idle) {
      this.fallback(job, 'queueFull');
      return handle;
    }
    this.queue.push(job);
    this.pump();
    return handle;
  }
  private pump() {
    if (this.closed) return;
    for (const slot of this.slots) {
      if (!slot.ready || slot.retiring || slot.busy || !slot.worker) continue;
      let job: Job | undefined;
      while ((job = this.queue.shift())) {
        if (job.settled) continue;
        if (performance.now() >= job.deadline) {
          this.fallback(job, 'budget');
          continue;
        }
        break;
      }
      if (!job || job.settled) continue;
      job.slot = slot;
      job.started = performance.now();
      slot.busy = job;
      this.counts.maxRunning = Math.max(
        this.counts.maxRunning,
        this.slots.filter((s) => s.busy !== null).length,
      );
      try {
        slot.worker.postMessage({
          ...job.request,
          remainingMs: Math.max(0.001, job.deadline - performance.now()),
        });
      } catch {
        this.retire(slot, 'workerError');
      }
    }
  }
  private message(slot: Slot, worker: Worker, value: unknown) {
    if (this.closed || slot.worker !== worker || slot.retiring) return;
    try {
      if (value && typeof value === 'object' && 'kind' in value && value.kind === 'ready') {
        const ready = exact(value, ['kind', 'threadId']);
        if (ready.threadId !== worker.threadId || slot.busy) throw Error('INVALID_READY');
        slot.ready = true;
        this.pump();
        return;
      }
      if (
        !value ||
        typeof value !== 'object' ||
        !('jobId' in value) ||
        typeof value.jobId !== 'string'
      ) {
        this.counts.discardedMessages++;
        return;
      }
      const job =
        this.jobs.get(value.jobId) ??
        (slot.busy?.request.jobId === value.jobId ? slot.busy : undefined);
      if (!job || job.slot !== slot || slot.busy !== job) {
        this.counts.discardedMessages++;
        return;
      }
      if ('kind' in value && value.kind === 'failure') {
        const failure = exact(value, ['kind', 'jobId', 'binding', 'threadId', 'reason']);
        if (
          failure.threadId !== worker.threadId ||
          failure.reason !== 'computeFailure' ||
          !sameBinding(failure.binding as BotJobBinding, job.request.binding)
        )
          throw Error('INVALID_FAILURE');
        this.retire(slot, 'workerError');
        return;
      }
      const result = parseWorkerResult(value, job.request, worker.threadId);
      this.clearGrace(job);
      slot.busy = null;
      if (job.settled) {
        this.counts.discardedMessages++;
        this.pump();
        return;
      }
      if (performance.now() >= job.deadline) this.fallback(job, 'budget');
      else if (result.estimate.stopReason === 'cancelled') this.fallback(job, 'cancelled');
      else if (result.estimate.completedSamples === 0) this.fallback(job, 'zeroSamples');
      else
        this.finish(job, {
          kind: 'estimate',
          estimate: result.estimate,
          threadId: worker.threadId,
          ...this.timing(job),
        });
      this.pump();
    } catch {
      const job = slot.busy;
      if (job) this.fallback(job, 'invalidMessage');
      this.retire(slot, 'invalidMessage');
    }
  }
  close() {
    return (this.closing ??= (async () => {
      this.closed = true;
      for (const job of [...this.jobs.values()]) this.fallback(job, 'closed');
      this.queue = [];
      for (const slot of this.slots) {
        if (slot.busy) this.clearGrace(slot.busy);
        this.retire(slot, 'closed');
      }
      await Promise.all([...this.terminations]);
      this.listeners.clear();
    })());
  }
}
