import type { BotObservation } from '../../apps/server/src/bots/bot-types.js';
import type { PolicyRandom } from '../../apps/server/src/bots/policy-basic.js';
import { projectBotObservation } from '../../apps/server/src/bots/observation.js';
import { botPrivacyContext } from './bot-privacy-scenarios.js';
export function seededRandom(seed = 77): PolicyRandom {
  let state = seed >>> 0;
  return {
    next: () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    },
  };
}
export function royalCase(
  n: 2 | 3 | 4 = 2,
  amounts: readonly number[] = Array.from({ length: n }, () => 100),
): BotObservation {
  const b = projectBotObservation(botPrivacyContext().rooms[0]!, 'bot-a')!;
  return {
    ...b,
    dealerSeatId: 0,
    smallBlindSeatId: n === 2 ? 0 : 1,
    bigBlindSeatId: n === 2 ? 1 : 2,
    phase: 'river',
    holeCards: ['2H', '3D'],
    board: ['10S', 'JS', 'QS', 'KS', 'AS'],
    players: Array.from({ length: n }, (_, i) => ({
      participantId: i === 0 ? b.participantId : 'opponent-' + i,
      seatId: i as 0 | 1 | 2 | 3,
      stack: 1000,
      handCommitted: amounts[i]!,
      streetCommitted: 0,
      folded: false,
      allIn: false,
      hiddenCardCount: 2,
    })),
    potTotal: amounts.reduce((a, b) => a + b, 0),
    legalActions: {
      allowed: ['fold', 'check', 'bet', 'allIn'],
      callAmount: 0,
      minRaiseTo: 20,
      maxRaiseTo: 1000,
      allIn: { raiseTo: 1000, additionalAmount: 1000, kind: 'bet' },
    },
  };
}
