import type { TimeoutToken } from './turn-timer.js';
import type { BotObservation, InternalBotAction } from '../bots/bot-types.js';
import type { Action } from '@orbit/protocol';
export type InternalCommand =
  | { readonly kind: 'timeout'; readonly token: TimeoutToken }
  | { readonly kind: 'bot'; readonly command: InternalBotAction };
export const botActionCommand = (observation: BotObservation, action: Action): InternalBotAction =>
  Object.freeze({
    roomId: observation.roomId,
    handId: observation.handId,
    turnId: observation.turnId,
    expectedVersion: observation.handVersion,
    participantId: observation.participantId,
    botId: observation.botId,
    deadline: observation.deadline,
    action: Object.freeze(
      action.type === 'bet' || action.type === 'raise'
        ? { type: action.type, raiseTo: action.raiseTo }
        : { type: action.type },
    ),
  });
export const timeoutCommand = (token: TimeoutToken): InternalCommand =>
  Object.freeze({ kind: 'timeout', token: Object.freeze({ ...token }) });
