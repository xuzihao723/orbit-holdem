import { expect, it } from 'vitest';
import { adaptBotIntent } from '../../apps/server/src/bots/action-adapter.js';
import { botPrivacyContext } from '../helpers/bot-privacy-scenarios.js';
import { projectBotObservation } from '../../apps/server/src/bots/observation.js';
import { applyHandAction } from '../../packages/poker-core/src/index.js';
import {
  getHandLegalActions,
  createHand,
  createDeck,
} from '../../packages/poker-core/src/index.js';
import { invalidHandCase } from '../helpers/invalid-hand-cases.js';
import type { CoreLegalActions } from '../../packages/poker-core/src/index.js';
const wire = (legal: CoreLegalActions) => ({
  ...legal,
  allowed: [...legal.allowed],
  allIn: legal.allIn ? { ...legal.allIn } : null,
});
it('never turns a short-all-in reopening restriction into a raise or all-in', () => {
  const { state } = invalidHandCase('raiseWithoutReopening', 0),
    legal = wire(getHandLegalActions(state, state.betting!.actorSeatId!));
  for (const intent of [{ type: 'raise', raiseTo: 250 }, { type: 'allIn' }]) {
    const action = adaptBotIntent(intent, legal);
    expect(action).toEqual({ type: 'fold' });
    expect(
      applyHandAction(state, {
        seatId: state.betting!.actorSeatId!,
        turnId: state.turnId!,
        action: action!,
      }).ok,
    ).toBe(true);
  }
});
it('uses the actual short call all-in amount and keeps an ordinary allowed call', () => {
  let state = createHand({
    handId: 'short-call',
    dealerSeatId: 2,
    deck: createDeck(),
    players: [100, 250, 400].map((stack, i) => ({
      stack,
      seatId: i as 0 | 1 | 2,
      participantId: 'p' + i,
    })),
  }).state;
  const pushed = applyHandAction(state, {
    seatId: 2,
    turnId: state.turnId!,
    action: { type: 'allIn' },
  });
  expect(pushed.ok).toBe(true);
  if (!pushed.ok) throw Error(pushed.reason);
  state = pushed.state;
  const legal = wire(getHandLegalActions(state, 0));
  expect(legal.callAmount).toBeGreaterThan(state.players[0]!.stack);
  expect(legal.allIn?.kind).toBe('call');
  const action = adaptBotIntent({ type: 'allIn' }, legal);
  expect(applyHandAction(state, { seatId: 0, turnId: state.turnId!, action: action! }).ok).toBe(
    true,
  );
  expect(adaptBotIntent({ type: 'call' }, legal)).toEqual(
    legal.allowed.includes('call') ? { type: 'call' } : { type: 'fold' },
  );
});
it('falls back on absent or inverted ranges without treating all-in as permission to bet', () => {
  const legal = projectBotObservation(botPrivacyContext().rooms[0]!, 'bot-a')!.legalActions;
  for (const changed of [
    { ...legal, minRaiseTo: null },
    { ...legal, minRaiseTo: 500, maxRaiseTo: 100 },
  ])
    expect(adaptBotIntent({ type: 'bet', raiseTo: 50 }, changed)).toEqual({ type: 'check' });
  expect(adaptBotIntent({ type: 'allIn' }, { ...legal, allowed: ['fold', 'check'] })).toEqual({
    type: 'check',
  });
  expect(adaptBotIntent({ type: 'bet', raiseTo: -1 }, legal)).toEqual({ type: 'check' });
});
it('preserves legal actions and clips only finite integer betting amounts to the allowed interval', () => {
  const r = botPrivacyContext(),
    room = r.rooms[0]!,
    o = projectBotObservation(room, r.botId)!,
    legal = o.legalActions;
  for (const intent of [
    { type: 'check' },
    { type: 'bet', raiseTo: 0 },
    { type: 'bet', raiseTo: 999999 },
    { type: 'allIn' },
  ] as const) {
    const action = adaptBotIntent(intent, legal);
    expect(action).not.toBeNull();
    expect(
      applyHandAction(room.hand!, { seatId: o.seatId, turnId: o.turnId, action: action! }).ok,
    ).toBe(true);
  }
  expect(adaptBotIntent({ type: 'bet', raiseTo: 0 }, legal)).toEqual({ type: 'bet', raiseTo: 20 });
  expect(adaptBotIntent({ type: 'bet', raiseTo: 999999 }, legal)).toEqual({
    type: 'bet',
    raiseTo: 1980,
  });
});
it.each([NaN, Infinity, -Infinity, 0.5])(
  'falls back safely for invalid number %s, never calls automatically',
  (raiseTo) => {
    const o = projectBotObservation(botPrivacyContext().rooms[0]!, 'bot-a')!;
    expect(adaptBotIntent({ type: 'bet', raiseTo }, o.legalActions)).toEqual({ type: 'check' });
    expect(
      adaptBotIntent(
        { type: 'raise', raiseTo },
        {
          ...o.legalActions,
          allowed: ['fold', 'call'],
          minRaiseTo: null,
          maxRaiseTo: null,
          allIn: null,
        },
      ),
    ).toEqual({ type: 'fold' });
    expect(adaptBotIntent({ type: 'call' }, { ...o.legalActions, allowed: [] })).toBeNull();
  },
);
