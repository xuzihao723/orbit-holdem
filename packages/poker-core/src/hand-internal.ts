import type { HandState, HandEvent, HandEventPayload } from './hand-types.js';
export interface HandWork {
  state: HandState;
  events: HandEvent[];
}
export function nextCounter(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER)
    throw new RangeError('UNSAFE_HAND_COUNTER');
  return value + 1;
}
export function freezeData<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeData(child);
  }
  return value;
}
export function emit(work: HandWork, payload: HandEventPayload): void {
  const sequence = nextCounter(work.state.eventSequence);
  work.state = { ...work.state, eventSequence: sequence };
  work.events.push(freezeData({ ...payload, sequence, handVersion: work.state.handVersion }));
}
export function complete(work: HandWork): {
  readonly state: HandState;
  readonly events: readonly HandEvent[];
} {
  return freezeData({ state: work.state, events: work.events });
}
