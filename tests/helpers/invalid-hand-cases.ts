import { createHand, applyHandAction } from '../../packages/poker-core/src/state.js';
import { createDeck } from '../../packages/poker-core/src/cards.js';
import type { Action } from '../../packages/poker-core/src/betting-types.js';
import type { CreateHandInput, HandState } from '../../packages/poker-core/src/hand-types.js';
import type { InvalidClass } from './invariant-scenarios.js';
export type HandRequest = Parameters<typeof applyHandAction>[1];
export function invalidDefinition(kind: InvalidClass, index: number) {
  const input: CreateHandInput = {
    handId: 'invalid-' + index,
    dealerSeatId: kind === 'raiseWithoutReopening' ? 3 : 0,
    deck: createDeck(),
    players: (kind === 'raiseWithoutReopening' ? [1020, 170, 1020, 1020] : [2000, 2000]).map(
      (stack, seatId) => ({ seatId: seatId as 0 | 1 | 2 | 3, participantId: 'p' + seatId, stack }),
    ),
  };
  const prefix: readonly Action[] =
    kind === 'raiseWithoutReopening'
      ? [
          { type: 'call' },
          { type: 'call' },
          { type: 'call' },
          { type: 'check' },
          { type: 'bet', raiseTo: 100 },
          { type: 'allIn' },
          { type: 'call' },
          { type: 'fold' },
        ]
      : [];
  const requestFor = (state: HandState): HandRequest => {
    let action: unknown = { type: 'raise', raiseTo: -1 - index };
    if (kind === 'wrongActor') action = { type: 'fold' };
    if (kind === 'fractionalRaise') action = { type: 'raise', raiseTo: 40.5 + (index % 10) };
    if (kind === 'belowMinimumNonAllInRaise')
      action = { type: 'raise', raiseTo: 21 + (index % 19) };
    if (kind === 'overStackRaise') action = { type: 'raise', raiseTo: 2001 + index };
    if (kind === 'checkWhileFacingBet') action = { type: 'check' };
    if (kind === 'raiseWithoutReopening')
      action = index % 2 ? { type: 'allIn' } : { type: 'raise', raiseTo: 250 };
    if (kind === 'unsafeInteger') action = { type: 'raise', raiseTo: Number.MAX_SAFE_INTEGER + 1 };
    if (kind === 'nonFiniteNumber') action = { type: 'raise', raiseTo: index % 2 ? Infinity : NaN };
    return {
      seatId: kind === 'wrongActor' ? 1 : state.betting!.actorSeatId!,
      turnId: state.turnId!,
      action,
    };
  };
  return { input, prefix, requestFor };
}
export function invalidHandCase(kind: InvalidClass, index: number) {
  const definition = invalidDefinition(kind, index);
  let state = createHand(definition.input).state;
  const prefix: HandRequest[] = [];
  for (const action of definition.prefix) {
    const request = { seatId: state.betting!.actorSeatId!, turnId: state.turnId!, action };
    const result = applyHandAction(state, request);
    if (!result.ok) throw new Error('UNEXPECTED_REJECTION:' + result.reason);
    prefix.push(request);
    state = result.state;
  }
  return { input: definition.input, prefix, state, request: definition.requestFor(state) };
}
