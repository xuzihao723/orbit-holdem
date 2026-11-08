import type { CommandHandler } from '../game/command-handler.js';
import type { ServerClock } from '../game/turn-timer.js';
import type { RoomState } from '../rooms/room-types.js';
import type { BotOptions, BotObservation } from './bot-types.js';
import { projectBotObservation } from './observation.js';
import { chooseBasicAction } from './policy-basic.js';
import { securePolicyRandom } from './bot-random.js';
import { adaptBotIntent } from './action-adapter.js';
import { botActionCommand } from '../game/internal-command.js';
import { chooseStandardAction } from './policy-monte-carlo.js';
import type { WorkerPool, JobHandle, WorkerOutcome } from './worker-pool.js';
interface Task {
  observation: BotObservation;
  handle: unknown | null;
  safe: boolean;
  submitted: boolean;
  standard: boolean;
  job?: JobHandle;
  outcome?: WorkerOutcome;
}
export class BotScheduler {
  private tasks = new Map<string, Task>();
  private closed = false;
  private remove: () => void;
  private policyRandom;
  private delayRandom;
  private samplingRandom;
  private fallbackReasons: Record<string, number> = {};
  private counts = {
    scheduled: 0,
    applied: 0,
    stale: 0,
    cancelled: 0,
    safeFallbacks: 0,
    standardEngineUnavailable: 0,
    workerJobs: 0,
    workerDecisions: 0,
    workerAcceptedActions: 0,
    workerSamples: 0,
    workerPartialJobs: 0,
    workerFallbacks: 0,
    discardedStale: 0,
  };
  constructor(
    private rooms: CommandHandler,
    private clock: ServerClock,
    private options: BotOptions = {},
    private getPool?: () => WorkerPool,
  ) {
    this.policyRandom = options.policyRandom ?? securePolicyRandom();
    this.delayRandom = options.delayRandom ?? securePolicyRandom();
    this.samplingRandom = options.samplingRandom ?? securePolicyRandom();
    this.remove = rooms.onCommitted((state) => this.sync(state));
  }
  get diagnostics() {
    return Object.freeze({
      ...this.counts,
      fallbackReasons: Object.freeze({ ...this.fallbackReasons }),
      active: this.tasks.size,
    });
  }
  private same(a: BotObservation, b: BotObservation) {
    return (
      a.handId === b.handId &&
      a.turnId === b.turnId &&
      a.handVersion === b.handVersion &&
      a.botId === b.botId &&
      a.participantId === b.participantId &&
      a.deadline === b.deadline
    );
  }
  private cancel(id: string) {
    const task = this.tasks.get(id);
    if (!task) return;
    this.tasks.delete(id);
    if (task.handle !== null) this.clock.clearTimer(task.handle);
    task.job?.cancel();
    this.counts.cancelled++;
  }
  sync(state: RoomState) {
    try {
      this.update(state);
    } catch {
      this.cancel(state.row.roomId);
      this.rooms.pauseForFault(state.row.roomId);
    }
  }
  private update(state: RoomState) {
    const id = state.row.roomId,
      actor = state.participants.find(
        (p) => p.seatId === state.hand?.betting?.actorSeatId && p.leftAt === null,
      ),
      observation = actor?.botId ? projectBotObservation(state, actor.botId) : null;
    if (this.closed || this.options.enabled === false || !observation) {
      this.cancel(id);
      return;
    }
    const previous = this.tasks.get(id);
    if (previous && this.same(previous.observation, observation)) return;
    this.cancel(id);
    try {
      let delay = 0,
        safe = false;
      try {
        const random = (
          this.options.randomForBot?.(observation.botId, 'delay') ?? this.delayRandom
        ).next();
        if (!Number.isFinite(random) || random < 0 || random >= 1)
          throw Error('INVALID_DELAY_RANDOM');
        delay = 500 + Math.floor(random * 1001);
      } catch {
        safe = true;
      }
      if (observation.deadline - this.clock.now() <= delay) {
        delay = 0;
        safe = true;
      }
      const task: Task = {
        observation,
        handle: null,
        safe,
        submitted: false,
        standard: actor?.botDifficulty === 'standard',
      };
      this.tasks.set(id, task);
      if (task.standard && !safe && observation.phase !== 'preflop' && this.getPool) {
        const n = (
          this.options.randomForBot?.(observation.botId, 'sampling') ?? this.samplingRandom
        ).next();
        if (!Number.isFinite(n) || n < 0 || n >= 1) throw Error('INVALID_SAMPLE_RANDOM');
        task.job = this.getPool().submit(observation, Math.floor(n * 0x100000000), 1000);
        this.counts.workerJobs++;
        void task.job.promise.then((outcome) => {
          if (this.closed || this.tasks.get(id) !== task) {
            this.counts.discardedStale++;
            return;
          }
          task.outcome = outcome;
        });
      }
      task.handle = this.clock.setTimer(() => this.run(task), delay);
      this.counts.scheduled++;
    } catch {
      this.cancel(id);
      this.rooms.pauseForFault(id);
    }
  }
  private run(task: Task) {
    try {
      this.runTask(task);
    } catch {
      this.cancel(task.observation.roomId);
      this.rooms.pauseForFault(task.observation.roomId);
    }
  }
  private runTask(task: Task) {
    const id = task.observation.roomId;
    if (this.closed || this.tasks.get(id) !== task || task.submitted) return;
    task.submitted = true;
    task.handle = null;
    const state = this.rooms.store.get(id),
      o = state ? projectBotObservation(state, task.observation.botId) : null;
    if (!o || !this.same(task.observation, o) || this.clock.now() >= o.deadline) {
      this.cancel(id);
      this.counts.stale++;
      return;
    }
    let usedWorker = false;
    if (task.standard && !task.safe && o.phase !== 'preflop') {
      if (task.outcome?.kind === 'estimate') {
        usedWorker = true;
        this.counts.workerDecisions++;
        this.counts.workerSamples += task.outcome.estimate.completedSamples;
        if (task.outcome.estimate.completedSamples < task.outcome.estimate.requestedSamples)
          this.counts.workerPartialJobs++;
      } else {
        this.counts.workerFallbacks++;
        const reason =
          task.outcome?.kind === 'fallback'
            ? task.outcome.reason
            : task.job
              ? 'displayBeforeResult'
              : 'standardEngineUnavailable';
        this.fallbackReasons[reason] = (this.fallbackReasons[reason] ?? 0) + 1;
        if (!task.job) this.counts.standardEngineUnavailable++;
        task.job?.cancel();
      }
    }
    const action = task.safe
      ? adaptBotIntent(null, o.legalActions)
      : task.standard && (o.phase === 'preflop' || usedWorker)
        ? chooseStandardAction(
            o,
            this.options.randomForBot?.(o.botId, 'policy') ?? this.policyRandom,
            task.outcome?.kind === 'estimate' ? task.outcome.estimate : undefined,
          )
        : chooseBasicAction(o, this.options.randomForBot?.(o.botId, 'policy') ?? this.policyRandom);
    if (task.safe) this.counts.safeFallbacks++;
    if (!action) {
      this.tasks.delete(id);
      return;
    }
    void this.rooms
      .executeBotAction(
        botActionCommand(o, action),
        () => !this.closed && this.tasks.get(id) === task,
      )
      .then((result) => {
        if (result === 'applied') {
          this.counts.applied++;
          if (usedWorker) this.counts.workerAcceptedActions++;
        } else this.counts.stale++;
      })
      .catch(() => {
        this.counts.stale++;
      })
      .finally(() => {
        if (this.tasks.get(id) === task) this.tasks.delete(id);
      });
  }
  close() {
    this.closed = true;
    this.remove();
    for (const id of [...this.tasks.keys()]) this.cancel(id);
  }
}
