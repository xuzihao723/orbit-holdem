import type { CoreLegalActions, Action } from '@orbit/poker-core';
export function timeoutAction(legal: CoreLegalActions): Action | null {
  return legal.allowed.includes('check')
    ? { type: 'check' }
    : legal.allowed.includes('fold')
      ? { type: 'fold' }
      : null;
}
