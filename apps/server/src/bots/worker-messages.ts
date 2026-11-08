import type { BotObservation, EquityEstimate } from './bot-types.js';
import { validateEquityObservation } from './sampling.js';
export interface BotJobBinding {
  jobId: string;
  roomId: string;
  handId: string;
  turnId: string;
  handVersion: number;
  botId: string;
  participantId: string;
}
export interface EquityWorkerJob {
  kind: 'estimate';
  jobId: string;
  binding: BotJobBinding;
  observation: BotObservation;
  seed: number;
  requestedSamples: number;
  remainingMs: number;
  cancellation: SharedArrayBuffer;
}
export interface EquityWorkerResult {
  kind: 'result';
  jobId: string;
  binding: BotJobBinding;
  threadId: number;
  estimate: EquityEstimate;
}
export function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some((d) => !('value' in d))
  )
    throw Error('INVALID_WORKER_MESSAGE');
  return value as Record<string, unknown>;
}
const safe = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const identifier = (v: unknown) =>
  typeof v === 'string' && v.length > 0 && v.length <= 256 && !/\s/.test(v);
const actions = ['fold', 'check', 'call', 'bet', 'raise', 'allIn'];
function list(value: unknown, max: number): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1 ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some((d) => !('value' in d))
  )
    throw Error('INVALID_WORKER_ARRAY');
  for (let i = 0; i < value.length; i++)
    if (!Object.hasOwn(value, i)) throw Error('INVALID_WORKER_ARRAY');
  return value;
}
export function bindingFor(jobId: string, o: BotObservation): BotJobBinding {
  return {
    jobId,
    roomId: o.roomId,
    handId: o.handId,
    turnId: o.turnId,
    handVersion: o.handVersion,
    botId: o.botId,
    participantId: o.participantId,
  };
}
export function sameBinding(a: BotJobBinding, b: BotJobBinding) {
  return Object.keys(b).every((k) => a[k as keyof BotJobBinding] === b[k as keyof BotJobBinding]);
}
function validateBinding(value: unknown): BotJobBinding {
  const v = exact(value, [
    'jobId',
    'roomId',
    'handId',
    'turnId',
    'handVersion',
    'botId',
    'participantId',
  ]);
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(v.jobId)) ||
    !['roomId', 'handId', 'turnId', 'botId', 'participantId'].every((k) => identifier(v[k])) ||
    !safe(v.handVersion) ||
    v.handVersion < 1
  )
    throw Error('INVALID_WORKER_BINDING');
  return v as unknown as BotJobBinding;
}
export function validateWorkerObservation(value: unknown): BotObservation {
  const v = exact(value, [
    'roomId',
    'handId',
    'turnId',
    'handVersion',
    'participantId',
    'botId',
    'seatId',
    'holeCards',
    'board',
    'phase',
    'dealerSeatId',
    'smallBlindSeatId',
    'bigBlindSeatId',
    'players',
    'legalActions',
    'potTotal',
    'deadline',
    'recentActions',
  ]);
  list(v.holeCards, 2);
  list(v.board, 5);
  list(v.players, 4);
  list(v.recentActions, 64);
  if (
    !['roomId', 'handId', 'turnId', 'participantId', 'botId'].every((k) => identifier(v[k])) ||
    !safe(v.handVersion) ||
    v.handVersion < 1 ||
    !safe(v.deadline) ||
    !Array.isArray(v.players) ||
    !Array.isArray(v.recentActions) ||
    v.recentActions.length > 64
  )
    throw Error('INVALID_WORKER_OBSERVATION');
  for (const key of ['seatId', 'dealerSeatId', 'smallBlindSeatId', 'bigBlindSeatId'])
    if (!safe(v[key]) || (v[key] as number) > 3) throw Error('INVALID_WORKER_SEAT');
  for (const p of v.players) {
    const r = exact(p, [
      'participantId',
      'seatId',
      'stack',
      'streetCommitted',
      'handCommitted',
      'folded',
      'allIn',
      'hiddenCardCount',
    ]);
    if (!identifier(r.participantId) || r.hiddenCardCount !== 2)
      throw Error('INVALID_WORKER_PLAYER');
  }
  const legal = exact(v.legalActions, [
    'allowed',
    'callAmount',
    'minRaiseTo',
    'maxRaiseTo',
    'allIn',
  ]);
  list(legal.allowed, 6);
  if (
    !Array.isArray(legal.allowed) ||
    new Set(legal.allowed).size !== legal.allowed.length ||
    legal.allowed.some((a) => !actions.includes(a as string)) ||
    !safe(legal.callAmount)
  )
    throw Error('INVALID_WORKER_LEGAL');
  for (const key of ['minRaiseTo', 'maxRaiseTo'])
    if (legal[key] !== null && !safe(legal[key])) throw Error('INVALID_WORKER_RANGE');
  if (legal.allIn !== null) {
    const a = exact(legal.allIn, ['raiseTo', 'additionalAmount', 'kind']);
    if (
      !safe(a.raiseTo) ||
      !safe(a.additionalAmount) ||
      !['bet', 'raise', 'call'].includes(String(a.kind))
    )
      throw Error('INVALID_WORKER_ALL_IN');
  }
  for (const action of v.recentActions) {
    const a = exact(action, ['sequence', 'seatId', 'actionType', 'paidAmount', 'raiseTo']);
    if (
      !safe(a.sequence) ||
      !safe(a.seatId) ||
      a.seatId > 3 ||
      !actions.includes(String(a.actionType)) ||
      !safe(a.paidAmount) ||
      (a.raiseTo !== null && !safe(a.raiseTo))
    )
      throw Error('INVALID_WORKER_ACTION');
  }
  const observation = v as unknown as BotObservation;
  validateEquityObservation(observation);
  return observation;
}
export function parseWorkerJob(value: unknown): EquityWorkerJob {
  const r = exact(value, [
      'kind',
      'jobId',
      'binding',
      'observation',
      'seed',
      'requestedSamples',
      'remainingMs',
      'cancellation',
    ]),
    binding = validateBinding(r.binding),
    o = validateWorkerObservation(r.observation);
  if (
    r.kind !== 'estimate' ||
    r.jobId !== binding.jobId ||
    !sameBinding(binding, bindingFor(binding.jobId, o)) ||
    !safe(r.seed) ||
    r.seed > 0xffffffff ||
    !safe(r.requestedSamples) ||
    r.requestedSamples < 1 ||
    r.requestedSamples > 10000 ||
    typeof r.remainingMs !== 'number' ||
    !Number.isFinite(r.remainingMs) ||
    r.remainingMs <= 0 ||
    r.remainingMs > 1000 ||
    !(r.cancellation instanceof SharedArrayBuffer) ||
    r.cancellation.byteLength !== 4
  )
    throw Error('INVALID_WORKER_JOB');
  return { ...r, binding, observation: o } as unknown as EquityWorkerJob;
}
export function parseWorkerResult(
  value: unknown,
  job: EquityWorkerJob,
  workerThreadId: number,
): EquityWorkerResult {
  const r = exact(value, ['kind', 'jobId', 'binding', 'threadId', 'estimate']),
    binding = validateBinding(r.binding),
    e = exact(r.estimate, [
      'requestedSamples',
      'completedSamples',
      'weightedShare',
      'expectedReturn',
      'additionalCallCost',
      'expectedNet',
      'stopReason',
    ]),
    own = job.observation.players.find((p) => p.participantId === job.observation.participantId)!,
    cost = Math.min(job.observation.legalActions.callAmount, own.stack);
  if (
    r.kind !== 'result' ||
    r.jobId !== job.jobId ||
    r.threadId !== workerThreadId ||
    !sameBinding(binding, job.binding) ||
    e.requestedSamples !== job.requestedSamples ||
    !safe(e.completedSamples) ||
    e.completedSamples > job.requestedSamples ||
    typeof e.weightedShare !== 'number' ||
    !Number.isFinite(e.weightedShare) ||
    e.weightedShare < 0 ||
    e.weightedShare > 1 ||
    typeof e.expectedReturn !== 'number' ||
    !Number.isFinite(e.expectedReturn) ||
    e.expectedReturn < 0 ||
    e.expectedReturn > job.observation.potTotal + cost ||
    e.additionalCallCost !== cost ||
    e.expectedNet !== e.expectedReturn - cost ||
    !['completed', 'budget', 'cancelled'].includes(String(e.stopReason)) ||
    (e.stopReason === 'completed' && e.completedSamples !== job.requestedSamples)
  )
    throw Error('INVALID_WORKER_RESULT');
  return { ...r, binding, estimate: e } as unknown as EquityWorkerResult;
}
