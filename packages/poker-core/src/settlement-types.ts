import type { SeatId, HoleCards } from './deck.js';
import type { HandRank, HandCategory } from './evaluate.js';
import type { Contribution, PotLayer, PotRefund } from './pots.js';
export interface SettlementBalance extends Contribution {
  readonly stack: number;
  readonly streetCommitted: number;
}
export interface RankedSeat {
  readonly seatId: SeatId;
  readonly rank: HandRank;
}
export interface SeatAllocation {
  readonly seatId: SeatId;
  readonly amount: number;
}
export interface CorePotAward extends PotLayer {
  readonly winnerSeatIds: readonly SeatId[];
  readonly allocations: readonly SeatAllocation[];
  readonly winningCategory: HandCategory | null;
}
export interface SettlementPlan {
  readonly reason: 'showdown' | 'allOthersFolded';
  readonly refunds: readonly PotRefund[];
  readonly pots: readonly CorePotAward[];
  readonly refundTotal: number;
  readonly payoutTotal: number;
  readonly originalContributionTotal: number;
}
export interface SettledBalance {
  readonly seatId: SeatId;
  readonly stack: number;
  readonly streetCommitted: 0;
  readonly handCommitted: 0;
}
export interface CoreSettlement {
  readonly plan: SettlementPlan;
  readonly finalBalances: readonly SettledBalance[];
}
export interface ShowdownSeat {
  readonly seatId: SeatId;
  readonly holeCards: HoleCards;
}
