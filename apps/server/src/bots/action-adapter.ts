import type { Action, LegalActionsView } from '@orbit/protocol';
import type { BotIntent } from './bot-types.js';
export function adaptBotIntent(intent: unknown, legal: LegalActionsView): Action | null {
  const fallback = () =>
    legal.allowed.includes('check')
      ? { type: 'check' as const }
      : legal.allowed.includes('fold')
        ? { type: 'fold' as const }
        : null;
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return fallback();
  const i = intent as Record<string, unknown>,
    type = i.type;
  if (typeof type !== 'string' || !legal.allowed.includes(type as Action['type']))
    return fallback();
  if (type === 'bet' || type === 'raise') {
    const amount = i.raiseTo,
      min = legal.minRaiseTo,
      max = legal.maxRaiseTo;
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      min === null ||
      max === null ||
      !Number.isSafeInteger(min) ||
      !Number.isSafeInteger(max) ||
      min < 0 ||
      min > max
    )
      return fallback();
    return { type, raiseTo: Math.min(max, Math.max(min, amount)) };
  }
  if (type === 'fold' || type === 'check' || type === 'call' || type === 'allIn') return { type };
  return fallback();
}
