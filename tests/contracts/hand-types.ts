import { getHandLegalActions, getLegalActions } from '@orbit/poker-core';
import type { HandState, BettingRound, CoreLegalActions, SeatId } from '@orbit/poker-core';
const hand: (s: HandState, id: SeatId) => CoreLegalActions = getHandLegalActions;
const round: (s: BettingRound, id: SeatId) => CoreLegalActions = getLegalActions;
void [hand, round];
