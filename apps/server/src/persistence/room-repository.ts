import { withSqlTransaction } from './transaction.js';
import { PersistenceError } from './errors.js';
import type { DatabaseSync } from 'node:sqlite';
import type { RoomRow, ParticipantRow, MatchRow, RoomRepositories } from './domain-rows.js';
import { json, text, integer, nullableInteger, nullableText, seat, choice } from './rows.js';
import {
  commitRoomChange,
  capacity,
  validateRoom,
  validateParticipant,
  validateMatch,
} from './room-commit.js';
export function roomRepository(db: DatabaseSync): RoomRepositories {
  return {
    commitRoomChange: (b) => commitRoomChange(db, b),
    updatePresenceVersion(roomId, expected) {
      text(roomId);
      integer(expected);
      if (expected === Number.MAX_SAFE_INTEGER)
        throw new PersistenceError('PERSISTENCE_STALE_VERSION');
      withSqlTransaction(db, () => {
        const r = db
          .prepare(
            "UPDATE rooms SET room_version=? WHERE room_id=? AND room_version=? AND status<>'closed'",
          )
          .run(expected + 1, roomId, expected);
        if (r.changes !== 1) throw new PersistenceError('PERSISTENCE_STALE_VERSION');
      });
    },
    readRoom(id) {
      const r = db.prepare('SELECT * FROM rooms WHERE room_id=?').get(text(id));
      if (!r) return null;
      const room: RoomRow = {
        resetProposal:
          r.reset_proposal_json === null
            ? null
            : (json(r.reset_proposal_json) as RoomRow['resetProposal']),
        roomId: text(r.room_id),
        roomCode: text(r.room_code),
        capacity: capacity(r.capacity),
        status: choice(r.status, [
          'waiting',
          'playing',
          'betweenHands',
          'matchFinished',
          'pausedFault',
          'closed',
        ]),
        roomVersion: integer(r.room_version),
        serverEpoch: text(r.server_epoch),
        hostParticipantId: nullableText(r.host_participant_id),
        matchId: nullableText(r.match_id),
        currentHandId: nullableText(r.current_hand_id),
        createdAt: integer(r.created_at),
        closedAt: nullableInteger(r.closed_at),
      };
      validateRoom(room);
      const participants: ParticipantRow[] = db
        .prepare('SELECT * FROM participants WHERE room_id=? ORDER BY joined_at,participant_id')
        .all(id)
        .map((p) => ({
          ready: p.ready === 1,
          botDifficulty:
            p.bot_difficulty === null ? null : choice(p.bot_difficulty, ['basic', 'standard']),
          participantId: text(p.participant_id),
          roomId: text(p.room_id),
          sessionId: nullableText(p.session_id),
          botId: nullableText(p.bot_id),
          seatId: seat(p.seat_id),
          nickname: text(p.nickname),
          stack: integer(p.stack),
          admission: choice(p.admission, ['waitingNextHand', 'active', 'eliminated', 'leaving']),
          joinedAt: integer(p.joined_at),
          leftAt: nullableInteger(p.left_at),
        }));
      participants.forEach(validateParticipant);
      const matches: MatchRow[] = db
        .prepare('SELECT * FROM matches WHERE room_id=? ORDER BY started_at,match_id')
        .all(id)
        .map((m) => ({
          matchId: text(m.match_id),
          roomId: text(m.room_id),
          status: choice(m.status, ['active', 'finished', 'interrupted']),
          lastBigBlindSeatId:
            m.last_big_blind_seat_id === null ? null : seat(m.last_big_blind_seat_id),
          startedAt: integer(m.started_at),
          endedAt: nullableInteger(m.ended_at),
        }));
      matches.forEach(validateMatch);
      return { room, participants, matches };
    },
  };
}
