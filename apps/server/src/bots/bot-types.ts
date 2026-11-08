import type {
  Action,
  CardId,
  CardPair,
  HandSeatView,
  LegalActionsView,
  SeatId,
} from '@orbit/protocol';
export interface BotObservation {
  roomId: string;
  handId: string;
  turnId: string;
  handVersion: number;
  participantId: string;
  botId: string;
  seatId: SeatId;
  holeCards: CardPair;
  board: readonly CardId[];
  phase: 'preflop' | 'flop' | 'turn' | 'river';
  dealerSeatId: SeatId;
  smallBlindSeatId: SeatId;
  bigBlindSeatId: SeatId;
  players: readonly HandSeatView[];
  legalActions: LegalActionsView;
  potTotal: number;
  deadline: number;
  recentActions: readonly {
    sequence: number;
    seatId: SeatId;
    actionType: Action['type'];
    paidAmount: number;
    raiseTo: number | null;
  }[];
}
export interface BotIntent {
  type: Action['type'];
  raiseTo?: number;
}
export interface InternalBotAction {
  roomId: string;
  handId: string;
  turnId: string;
  expectedVersion: number;
  participantId: string;
  botId: string;
  deadline: number;
  action: Action;
}
export interface BotOptions {
  randomForBot?: (
    botId: string,
    kind: 'policy' | 'delay' | 'sampling',
  ) => import('./policy-basic.js').PolicyRandom;
  enabled?: boolean;
  policyRandom?: import('./policy-basic.js').PolicyRandom;
  delayRandom?: import('./policy-basic.js').PolicyRandom;
  samplingRandom?: import('./policy-basic.js').PolicyRandom;
}
export interface EquityEstimate {
  requestedSamples: number;
  completedSamples: number;
  weightedShare: number;
  expectedReturn: number;
  additionalCallCost: number;
  expectedNet: number;
  stopReason: 'completed' | 'budget' | 'cancelled';
}
export interface SampleControl {
  shouldStop(): boolean;
  reason?(): 'budget' | 'cancelled';
}
export interface UnknownSample {
  board: CardId[];
  opponents: { seatId: SeatId; holeCards: CardPair }[];
}
