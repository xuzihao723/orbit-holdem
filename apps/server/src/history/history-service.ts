import type { HistoryItem, HistoryResponse, ReplayResponse } from '@orbit/protocol';
import type { PokerDatabase } from '../persistence/rows.js';
import type { SessionRuntime } from '../sessions/session-types.js';
import type { AuthenticatedQuery, QueryExecutor } from '../transport/types.js';
import { privateFailure } from '../transport/errors.js';
import { RoomError } from '../rooms/room-types.js';
import { projectReplay } from '../persistence/replay-projector.js';
import { decodeHistoryCursor, encodeHistoryCursor } from './history-cursor.js';
export class HistoryService implements QueryExecutor {
  private projecting = new Set<string>();
  constructor(
    private db: PokerDatabase,
    private sessions: SessionRuntime,
  ) {}
  private check(q: AuthenticatedQuery) {
    const check = this.sessions.service.checkController(q.control);
    if (!check.ok) throw new RoomError(check.reason);
  }
  async executeQuery(q: AuthenticatedQuery): Promise<HistoryResponse | ReplayResponse> {
    try {
      this.check(q);
      const session = q.control.sessionId,
        repo = this.db.repositories;
      if (q.event === 'history:list') {
        const anchor = decodeHistoryCursor(q.payload.cursor, session),
          limit = q.payload.limit ?? 20;
        if (anchor) {
          if (
            !repo.findHandParticipant(session, anchor.handId) ||
            this.db.hands.readHand(anchor.handId)?.startedAt !== anchor.startedAt
          )
            throw new RoomError('INVALID_INPUT');
        }
        const rows = repo.listOwnedHistory(session, anchor, limit + 1),
          items: HistoryItem[] = [];
        for (const item of rows.slice(0, limit)) {
          const row = this.db.hands.readHand(item.handId);
          if (!row || row.status === 'active' || row.endedAt === null)
            throw Error('INVALID_HISTORY_ROW');
          const startingStack = row.startingStacks.find(
            (p) => p.participantId === item.participantId,
          )!.stack;
          const base = {
            roomId: row.roomId,
            matchId: row.matchId,
            handId: row.handId,
            participantId: item.participantId,
            playerCount: row.participantIds.length as 2 | 3 | 4,
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            startingStack,
          };
          if (row.status === 'interrupted')
            items.push({
              ...base,
              status: 'interrupted',
              endingStack: null,
              netHandChange: null,
              wonAnyPot: null,
            });
          else {
            const endingStack = row.result!.finalStacks.find(
              (p) => p.participantId === item.participantId,
            )!.stack;
            items.push({
              ...base,
              status: 'settled',
              endingStack,
              netHandChange: endingStack - startingStack,
              wonAnyPot: row.result!.pots.some((p) =>
                p.allocations.some((a) => a.participantId === item.participantId && a.amount > 0),
              ),
            });
          }
        }
        this.check(q);
        return {
          ...this.sessions.meta(),
          requestId: q.payload.requestId,
          ok: true,
          items,
          nextCursor: rows.length > limit ? encodeHistoryCursor(session, rows[limit - 1]!) : null,
        };
      }
      const viewer = repo.findHandParticipant(session, q.payload.handId);
      if (!viewer) throw new RoomError('REPLAY_FORBIDDEN');
      const row = this.db.hands.readHand(q.payload.handId);
      if (!row) throw new RoomError('REPLAY_FORBIDDEN');
      if (row.status === 'active') throw new RoomError('HAND_IN_PROGRESS');
      if (this.projecting.has(session)) throw new RoomError('RATE_LIMITED');
      this.projecting.add(session);
      try {
        const projected = await projectReplay(
          row,
          repo.readReplayEvents(row.handId),
          viewer,
          async () => {
            await new Promise<void>((r) => setImmediate(r));
            this.check(q);
          },
        );
        const response: ReplayResponse = {
          ...this.sessions.meta(),
          ok: true,
          requestId: q.payload.requestId,
          handId: row.handId,
          viewerParticipantId: viewer,
          ...projected,
        };
        if (Buffer.byteLength(JSON.stringify(response)) > 16 * 1024 * 1024)
          throw Error('REPLAY_SIZE_LIMIT');
        this.check(q);
        return response;
      } finally {
        this.projecting.delete(session);
      }
    } catch (error) {
      return privateFailure(
        this.sessions.meta(),
        q.payload,
        error instanceof RoomError ? error.code : 'PERSISTENCE_UNAVAILABLE',
      );
    }
  }
}
