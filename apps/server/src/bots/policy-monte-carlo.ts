import type { Action } from '@orbit/protocol';
import type { BotObservation, EquityEstimate } from './bot-types.js';
import type { PolicyRandom } from './policy-basic.js';
import { chooseBasicAction, assessBasic } from './policy-basic.js';
import { classifyPreflop, PREFLOP_TABLE } from './preflop-table.js';
import { adaptBotIntent } from './action-adapter.js';
export function chooseStandardAction(
  o: BotObservation,
  random: PolicyRandom,
  estimate?: EquityEstimate,
): Action | null {
  const safe = () => adaptBotIntent(null, o.legalActions);
  try {
    if (o.phase === 'preflop')
      return chooseBasicAction(o, random, PREFLOP_TABLE[classifyPreflop(o.holeCards)]!.score);
    if (
      !estimate ||
      estimate.completedSamples === 0 ||
      !Number.isFinite(estimate.expectedNet) ||
      !Number.isFinite(estimate.weightedShare) ||
      estimate.weightedShare < 0 ||
      estimate.weightedShare > 1
    )
      return chooseBasicAction(o, random);
    const legal = o.legalActions,
      raiseType = legal.allowed.includes('bet')
        ? 'bet'
        : legal.allowed.includes('raise')
          ? 'raise'
          : null;
    if (!legal.allowed.includes('check') && estimate.expectedNet <= 0) return safe();
    if (
      estimate.weightedShare >= 0.65 &&
      assessBasic(o).costRatio <= 0.25 &&
      raiseType &&
      legal.minRaiseTo !== null
    ) {
      const draw = random.next();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw Error('INVALID_POLICY_RANDOM');
      if (draw < 0.35)
        return adaptBotIntent(
          {
            type: raiseType,
            raiseTo: Math.min(legal.maxRaiseTo ?? legal.minRaiseTo, legal.minRaiseTo * 2),
          },
          legal,
        );
    }
    if (legal.allowed.includes('check')) return { type: 'check' };
    if (legal.allowed.includes('call')) return { type: 'call' };
    if (legal.allowed.includes('allIn') && legal.allIn?.kind === 'call') return { type: 'allIn' };
    return safe();
  } catch {
    return safe();
  }
}
