import type { SeatId, RoomView, HandPublicState, PlayerView } from '@orbit/protocol';
export interface TablePreview {
  room: RoomView;
  hand: HandPublicState;
  self: PlayerView['self'] | null;
  viewerSeatId: SeatId | null;
  connection: 'connected' | 'disconnected';
  remainingSeconds: number | null;
  live?: boolean;
}
export type GrayboxFixture =
  | { id: string; label: string; page: 'lobby'; room: RoomView; viewerSeatId: SeatId }
  | { id: string; label: string; page: 'table'; table: TablePreview };
