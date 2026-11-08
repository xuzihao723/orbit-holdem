import type { Capacity, SeatId, RoomStatus, Admission } from '@orbit/protocol';
import type { LedgerInsert, ReceiptInsert } from './rows.js';
export interface RoomRow {
  readonly resetProposal: {
    readonly proposedByParticipantId: string;
    readonly proposedAt: number;
  } | null;
  readonly roomId: string;
  readonly roomCode: string;
  readonly capacity: Capacity;
  readonly status: RoomStatus;
  readonly roomVersion: number;
  readonly serverEpoch: string;
  readonly hostParticipantId: string | null;
  readonly matchId: string | null;
  readonly currentHandId: string | null;
  readonly createdAt: number;
  readonly closedAt: number | null;
}
export interface ParticipantRow {
  readonly ready: boolean;
  readonly botDifficulty: 'basic' | 'standard' | null;
  readonly participantId: string;
  readonly roomId: string;
  readonly sessionId: string | null;
  readonly botId: string | null;
  readonly seatId: SeatId;
  readonly nickname: string;
  readonly stack: number;
  readonly admission: Admission;
  readonly joinedAt: number;
  readonly leftAt: number | null;
}
export interface MatchRow {
  readonly matchId: string;
  readonly roomId: string;
  readonly status: 'active' | 'finished' | 'interrupted';
  readonly lastBigBlindSeatId: SeatId | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
}
export interface RoomCommit {
  readonly expectedRoomVersion: number | null;
  readonly room: RoomRow;
  readonly participantWrites: readonly ParticipantRow[];
  readonly matchWrites: readonly MatchRow[];
  readonly ledger: readonly LedgerInsert[];
  readonly receipt: ReceiptInsert;
}
export interface BoundaryCommit extends RoomCommit {
  readonly failedRoomVersion: number | null;
}
export interface RoomRepositories {
  updatePresenceVersion(roomId: string, expected: number): void;
  commitRoomChange(batch: RoomCommit): void;
  readRoom(roomId: string): {
    room: RoomRow;
    participants: readonly ParticipantRow[];
    matches: readonly MatchRow[];
  } | null;
}
