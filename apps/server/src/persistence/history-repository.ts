import type { DatabaseSync } from 'node:sqlite';
import { databaseError } from './errors.js';
import { handGraph } from './hand-graph.js';
import type { HistoryAnchor } from './history-rows.js';
import type { EventInsert } from './rows.js';
import { validateEvent } from './payloads.js';
import {
  text,
  nullableInteger,
  choice,
  type HandOwnership,
  type ParticipantOwnership,
} from './rows.js';
const owned =
  'FROM hands h WHERE EXISTS (SELECT 1 FROM json_each(h.participant_ids_json) roster JOIN participants p ON p.participant_id=roster.value WHERE p.session_id=? AND p.room_id=h.room_id)';
export function historyRepository(db: DatabaseSync) {
  return {
    findHandParticipant(sessionId: string, handId: string): string | null {
      try {
        const r = db
          .prepare(
            'SELECT p.participant_id FROM hands h JOIN json_each(h.participant_ids_json) roster JOIN participants p ON p.participant_id=roster.value AND p.room_id=h.room_id WHERE h.hand_id=? AND p.session_id=? LIMIT 1',
          )
          .get(text(handId), text(sessionId));
        return r ? text(r.participant_id) : null;
      } catch (error) {
        throw databaseError(error);
      }
    },
    listOwnedHistory(sessionId: string, anchor: HistoryAnchor | null, limit: number) {
      try {
        if (!Number.isInteger(limit) || limit < 1 || limit > 51)
          throw Error('INVALID_HISTORY_LIMIT');
        const sql =
          'SELECT h.hand_id,h.started_at,(SELECT p.participant_id FROM json_each(h.participant_ids_json) roster JOIN participants p ON p.participant_id=roster.value AND p.room_id=h.room_id WHERE p.session_id=? LIMIT 1) AS participant_id ' +
          owned +
          " AND h.status IN ('settled','interrupted') " +
          (anchor ? ' AND (h.started_at < ? OR (h.started_at = ? AND h.hand_id < ?)) ' : '') +
          ' ORDER BY h.started_at DESC,h.hand_id DESC LIMIT ?';
        const params = anchor
          ? [
              text(sessionId),
              text(sessionId),
              anchor.startedAt,
              anchor.startedAt,
              text(anchor.handId),
              limit,
            ]
          : [text(sessionId), text(sessionId), limit];
        return db
          .prepare(sql)
          .all(...params)
          .map((r) => ({
            handId: text(r.hand_id),
            startedAt: Number(r.started_at),
            participantId: text(r.participant_id),
          }));
      } catch (error) {
        throw databaseError(error);
      }
    },
    readReplayEvents(handId: string): readonly EventInsert[] {
      try {
        const rows = db
          .prepare('SELECT * FROM hand_events WHERE hand_id=? ORDER BY sequence LIMIT 10001')
          .all(text(handId));
        if (rows.length > 10000) throw Error('REPLAY_LIMIT');
        return rows.map((r) => {
          const event: EventInsert = {
            handId: text(r.hand_id),
            sequence: Number(r.sequence),
            handVersion: Number(r.hand_version),
            kind: text(r.kind),
            payload: JSON.parse(String(r.payload_json)),
            visibility: r.visibility as EventInsert['visibility'],
            ownerParticipantId:
              r.owner_participant_id === null ? null : text(r.owner_participant_id),
            occurredAt: Number(r.occurred_at),
          };
          validateEvent(event);
          return event;
        });
      } catch (error) {
        throw databaseError(error);
      }
    },
    listOwnedHandIds(sessionId: string): readonly string[] {
      try {
        return Object.freeze(
          db
            .prepare(
              'SELECT h.hand_id ' +
                owned +
                " AND h.status IN ('settled','interrupted') ORDER BY h.started_at,h.hand_id",
            )
            .all(text(sessionId))
            .map((r) => {
              const id = text(r.hand_id);
              handGraph(db, id);
              return id;
            }),
        );
      } catch (error) {
        throw databaseError(error);
      }
    },
    findOwnedHand(sessionId: string, handId: string): HandOwnership | null {
      try {
        const r = db
          .prepare(
            'SELECT h.hand_id,h.room_id,h.status,h.start_epoch ' + owned + ' AND h.hand_id=?',
          )
          .get(text(sessionId), text(handId));
        if (r) handGraph(db, text(r.hand_id));
        return r
          ? Object.freeze({
              handId: text(r.hand_id),
              roomId: text(r.room_id),
              status: choice(r.status, ['active', 'settled', 'interrupted']),
              startEpoch: text(r.start_epoch),
            })
          : null;
      } catch (error) {
        throw databaseError(error);
      }
    },
    findOwnedParticipantInRoom(sessionId: string, roomId: string): ParticipantOwnership | null {
      try {
        const r = db
          .prepare(
            'SELECT p.participant_id,p.left_at,r.status,r.server_epoch FROM participants p JOIN rooms r ON p.room_id=r.room_id WHERE p.session_id=? AND p.room_id=? ORDER BY p.joined_at DESC,p.participant_id DESC LIMIT 1',
          )
          .get(text(sessionId), text(roomId));
        return r
          ? Object.freeze({
              participantId: text(r.participant_id),
              leftAt: nullableInteger(r.left_at),
              roomStatus: choice(r.status, [
                'waiting',
                'playing',
                'betweenHands',
                'matchFinished',
                'pausedFault',
                'closed',
              ]),
              serverEpoch: text(r.server_epoch),
            })
          : null;
      } catch (error) {
        throw databaseError(error);
      }
    },
  };
}
