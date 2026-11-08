import type { EventInsert } from './rows.js';
export interface HistoryAnchor {
  startedAt: number;
  handId: string;
}
export interface OwnedHistoryRow extends HistoryAnchor {
  participantId: string;
}
export interface HistoryReadRepository {
  listOwnedHistory(
    sessionId: string,
    anchor: HistoryAnchor | null,
    limit: number,
  ): readonly OwnedHistoryRow[];
  findHandParticipant(sessionId: string, handId: string): string | null;
  readReplayEvents(handId: string): readonly EventInsert[];
}
