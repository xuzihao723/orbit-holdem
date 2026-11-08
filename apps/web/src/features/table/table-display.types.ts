import type { SeatId, ReplayState, CardPair, Admission, BotDifficulty } from '@orbit/protocol';
export interface TableSeatIdentity {
  seatId: SeatId;
  participantId: string;
  nickname: string;
  stack: number;
  kind?: 'human' | 'bot';
  difficulty?: BotDifficulty | null;
  online?: boolean;
  ready?: boolean | null;
  isHost?: boolean;
  admission?: Admission;
}
export interface TableDisplayProps {
  seats: readonly TableSeatIdentity[];
  hand: ReplayState;
  self: { holeCards: CardPair | null } | null;
  viewerSeatId: SeatId | null;
  connection: 'connected' | 'disconnected';
  remainingSeconds: number | null;
  live?: boolean;
  replay?: boolean;
}
