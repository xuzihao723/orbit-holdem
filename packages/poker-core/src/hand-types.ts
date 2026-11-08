import type { CardId } from './cards.js';
import type { DeckState, HoleCards, SeatId } from './deck.js';
import type { BettingPlayer, BettingRound, ActionFailureReason } from './betting-types.js';
import type { Positions } from './positions.js';
import type { CoreSettlement } from './settlement-types.js';
import type { PotRefund } from './pots.js';
export type HandPhase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'settled';
export interface HandPlayer extends BettingPlayer {
  readonly participantId: string;
  readonly holeCards: HoleCards;
  readonly startingStack: number;
}
export interface CoreHandResult {
  readonly reason: 'showdown' | 'allOthersFolded';
  readonly settlement: CoreSettlement;
  readonly refunds: readonly PotRefund[];
  readonly showdownCards: readonly { readonly seatId: SeatId; readonly cards: HoleCards }[];
}
export interface HandState {
  readonly handId: string;
  readonly handVersion: number;
  readonly turnSerial: number;
  readonly turnId: string | null;
  readonly phase: HandPhase;
  readonly positions: Positions;
  readonly initialChipTotal: number;
  readonly players: readonly HandPlayer[];
  readonly deck: DeckState;
  readonly burnCards: readonly CardId[];
  readonly board: readonly CardId[];
  readonly betting: Omit<BettingRound, 'players'> | null;
  readonly issuedRefunds: readonly PotRefund[];
  readonly eventSequence: number;
  readonly settlementCount: 0 | 1;
  readonly result: CoreHandResult | null;
}
export interface CreateHandInput {
  readonly handId: string;
  readonly dealerSeatId: SeatId;
  readonly deck: readonly CardId[];
  readonly players: readonly {
    readonly seatId: SeatId;
    readonly participantId: string;
    readonly stack: number;
  }[];
}
export type HandFailureReason = ActionFailureReason | 'HAND_SETTLED' | 'TURN_MISMATCH';
export type HandEventPayload =
  | {
      readonly kind: 'handStarted';
      readonly visibility: 'public';
      readonly dealerSeatId: SeatId;
      readonly seats: readonly SeatId[];
    }
  | {
      readonly kind: 'blindPosted';
      readonly visibility: 'public';
      readonly seatId: SeatId;
      readonly amount: number;
    }
  | {
      readonly kind: 'holeDealt';
      readonly visibility: 'owner';
      readonly seatId: SeatId;
      readonly cards: HoleCards;
    }
  | {
      readonly kind: 'actionApplied';
      readonly visibility: 'public';
      readonly seatId: SeatId;
      readonly actionType: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn';
      readonly paidAmount: number;
      readonly raiseTo: number | null;
    }
  | { readonly kind: 'cardBurned'; readonly visibility: 'internal'; readonly card: CardId }
  | {
      readonly kind: 'boardDealt';
      readonly visibility: 'public';
      readonly street: 'flop' | 'turn' | 'river';
      readonly cards: readonly CardId[];
    }
  | {
      readonly kind: 'refunded';
      readonly visibility: 'public';
      readonly seatId: SeatId;
      readonly amount: number;
    }
  | {
      readonly kind: 'potsBuilt';
      readonly visibility: 'public';
      readonly pots: CoreSettlement['plan']['pots'];
    }
  | {
      readonly kind: 'showdownRevealed';
      readonly visibility: 'public';
      readonly cards: CoreHandResult['showdownCards'];
    }
  | {
      readonly kind: 'paidOut';
      readonly visibility: 'public';
      readonly seatId: SeatId;
      readonly potId: string;
      readonly amount: number;
    }
  | {
      readonly kind: 'handSettled';
      readonly visibility: 'public';
      readonly reason: 'showdown' | 'allOthersFolded';
    };
export type HandEvent = HandEventPayload & {
  readonly sequence: number;
  readonly handVersion: number;
};
export type HandActionResult =
  | { readonly ok: true; readonly state: HandState; readonly events: readonly HandEvent[] }
  | {
      readonly ok: false;
      readonly reason: HandFailureReason;
      readonly state: HandState;
      readonly events: readonly [];
    };
