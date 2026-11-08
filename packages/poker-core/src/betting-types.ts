import type { SeatId } from './deck.js';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export interface BettingPlayer {
  readonly seatId: SeatId;
  readonly stack: number;
  readonly streetCommitted: number;
  readonly handCommitted: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  readonly lastActedAtBet: number | null;
}
export interface BettingRound {
  readonly street: Street;
  readonly bigBlind: number;
  readonly currentBet: number;
  readonly lastFullRaiseSize: number;
  readonly players: readonly BettingPlayer[];
  readonly actionOrder: readonly SeatId[];
  readonly pendingSeatIds: readonly SeatId[];
  readonly actorSeatId: SeatId | null;
}
export type Action =
  | { readonly type: 'fold' }
  | { readonly type: 'check' }
  | { readonly type: 'call' }
  | { readonly type: 'bet'; readonly raiseTo: number }
  | { readonly type: 'raise'; readonly raiseTo: number }
  | { readonly type: 'allIn' };

export interface CoreLegalActions {
  readonly allowed: readonly Action['type'][];
  readonly callAmount: number;
  readonly minRaiseTo: number | null;
  readonly maxRaiseTo: number | null;
  readonly allIn: {
    readonly raiseTo: number;
    readonly additionalAmount: number;
    readonly kind: 'call' | 'bet' | 'raise';
  } | null;
}
export type ActionFailureReason = 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION' | 'ILLEGAL_AMOUNT';
export interface BettingEffect {
  readonly actingSeatId: SeatId;
  readonly players: readonly BettingPlayer[];
  readonly currentBet: number;
  readonly lastFullRaiseSize: number;
  readonly paidAmount: number;
  readonly kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  readonly isAllIn: boolean;
  readonly raiseClass: 'none' | 'short' | 'full';
}
export type AmountResult =
  | { readonly ok: true; readonly effect: BettingEffect }
  | { readonly ok: false; readonly reason: ActionFailureReason; readonly state: BettingRound };
export type RoundOutcome = 'continue' | 'streetComplete' | 'runout' | 'uncontested';
export type RoundActionResult =
  | {
      readonly ok: true;
      readonly state: BettingRound;
      readonly effect: BettingEffect;
      readonly outcome: RoundOutcome;
    }
  | { readonly ok: false; readonly reason: ActionFailureReason; readonly state: BettingRound };
