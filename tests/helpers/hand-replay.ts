import {
  createHand,
  applyHandAction,
  getHandLegalActions,
} from '../../packages/poker-core/src/state.js';
import type {
  CreateHandInput,
  HandState,
  HandEvent,
} from '../../packages/poker-core/src/hand-types.js';
import type { Action } from '../../packages/poker-core/src/betting-types.js';
export function stepHand(state: HandState, action: Action) {
  const seatId = state.betting?.actorSeatId;
  if (seatId === null || seatId === undefined || state.turnId === null)
    throw new Error('MISSING_HAND_ACTOR');
  const result = applyHandAction(state, { seatId, turnId: state.turnId, action });
  if (!result.ok) throw new Error(result.reason);
  return result;
}
export function passiveHand(input: CreateHandInput) {
  const initial = createHand(input);
  let state = initial.state;
  const events: HandEvent[] = [...initial.events],
    trace: unknown[] = [{ state, events: initial.events }];
  for (let count = 0; count < 50 && state.phase !== 'settled'; count++) {
    const actor = state.betting?.actorSeatId;
    if (actor === null || actor === undefined) throw new Error('PASSIVE_NO_ACTOR');
    const legal = getHandLegalActions(state, actor);
    const action: Action = legal.allowed.includes('check')
      ? { type: 'check' }
      : legal.allowed.includes('call')
        ? { type: 'call' }
        : legal.allowed.includes('allIn')
          ? { type: 'allIn' }
          : { type: 'fold' };
    const result = stepHand(state, action);
    state = result.state;
    events.push(...result.events);
    trace.push({ action, state, events: result.events });
  }
  if (state.phase !== 'settled') throw new Error('PASSIVE_ACTION_LIMIT');
  return { state, events, trace };
}
