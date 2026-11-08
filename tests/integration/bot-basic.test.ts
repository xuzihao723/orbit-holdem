import { expect, it } from 'vitest';
import { preflopStrength } from '../../apps/server/src/bots/preflop-strength.js';
import { chooseBasicAction, assessBasic } from '../../apps/server/src/bots/policy-basic.js';
import type { BotObservation } from '../../apps/server/src/bots/bot-types.js';
import { projectBotObservation } from '../../apps/server/src/bots/observation.js';
import { botPrivacyContext } from '../helpers/bot-privacy-scenarios.js';
const base = () => projectBotObservation(botPrivacyContext().rooms[0]!, 'bot-a')!;
it.each([
  ['AS', 'AH', 65],
  ['KS', 'KH', 63],
  ['2S', '2H', 41],
  ['AS', 'KS', 36],
  ['7H', '8H', 24],
  ['AS', '2D', 20],
] as const)('scores %s %s as project-defined %i', (a, b, score) =>
  expect(preflopStrength([a, b])).toBe(score),
);
it('adjusts preflop thresholds for late position and four-handed play without changing cards', () => {
  const o = { ...base(), phase: 'preflop' as const, board: [] };
  expect(assessBasic(o).score).toBe(69);
  expect(assessBasic({ ...o, dealerSeatId: 0, smallBlindSeatId: 0, bigBlindSeatId: 1 }).score).toBe(
    65,
  );
  const four = {
    ...o,
    dealerSeatId: 0 as const,
    smallBlindSeatId: 1 as const,
    bigBlindSeatId: 2 as const,
    players: [
      ...o.players,
      ...[2, 3].map((seatId) => ({
        ...o.players[1]!,
        seatId: seatId as 2 | 3,
        participantId: 'p' + seatId,
      })),
    ],
  };
  expect(assessBasic(four).score).toBe(61);
});
it('checks medium visible pair but randomizes the smallest legal bet with a strong made hand', () => {
  const o = base();
  expect(chooseBasicAction(o, { next: () => 0 })).toEqual({ type: 'check' });
  const strong = { ...o, board: ['AC', '3D', '4C'] } as BotObservation;
  expect(chooseBasicAction(strong, { next: () => 0.1 })).toEqual({ type: 'bet', raiseTo: 20 });
  expect(chooseBasicAction(strong, { next: () => 0.9 })).toEqual({ type: 'check' });
});
it('folds expensive calls, continues cheap ones and caps short-all-in cost at its actual stack', () => {
  const o = base(),
    paid = {
      ...o,
      phase: 'preflop' as const,
      board: [],
      potTotal: 100,
      legalActions: {
        allowed: ['fold', 'call', 'allIn'] as const,
        callAmount: 200,
        minRaiseTo: null,
        maxRaiseTo: null,
        allIn: { raiseTo: 220, additionalAmount: 200, kind: 'call' as const },
      },
    };
  const regular = {
    ...paid,
    legalActions: { ...paid.legalActions, allowed: [...paid.legalActions.allowed] },
  };
  expect(chooseBasicAction(regular, { next: () => 0.9 })).toEqual({ type: 'fold' });
  const short = {
    ...regular,
    players: regular.players.map((p) =>
      p.participantId === regular.participantId ? { ...p, stack: 10 } : p,
    ),
    legalActions: {
      ...regular.legalActions,
      allowed: ['fold', 'allIn'] as ('fold' | 'allIn')[],
      allIn: { raiseTo: 30, additionalAmount: 10, kind: 'call' as const },
    },
  };
  expect(assessBasic(short).costRatio).toBeCloseTo(10 / 110);
  expect(chooseBasicAction(short, { next: () => 0.9 })).toEqual({ type: 'allIn' });
  expect(chooseBasicAction({ ...short, holeCards: ['2S', '7D'] }, { next: () => 0.9 })).toEqual({
    type: 'fold',
  });
});
it('keeps an allowed call when raise permission is absent and safely handles policy errors or no actions', () => {
  const o = {
    ...base(),
    phase: 'preflop' as const,
    board: [],
    potTotal: 100,
    legalActions: {
      allowed: ['fold', 'call'] as ('fold' | 'call')[],
      callAmount: 10,
      minRaiseTo: null,
      maxRaiseTo: null,
      allIn: null,
    },
  };
  expect(chooseBasicAction(o, { next: () => 0.1 })).toEqual({ type: 'call' });
  const strong = { ...base(), board: ['AC', '3D', '4C'] } as BotObservation;
  expect(
    chooseBasicAction(strong, {
      next: () => {
        throw Error('fixture RNG unavailable');
      },
    }),
  ).toEqual({ type: 'check' });
  expect(
    chooseBasicAction(
      { ...strong, legalActions: { ...strong.legalActions, allowed: [] } },
      { next: () => 0 },
    ),
  ).toBeNull();
  expect(chooseBasicAction(strong, { next: () => 1 })).toEqual({ type: 'check' });
  expect(chooseBasicAction(strong, { next: () => 0.1 })).toEqual(
    chooseBasicAction(strong, { next: () => 0.1 }),
  );
});
