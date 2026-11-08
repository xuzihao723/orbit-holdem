import type { DatabaseSync } from 'node:sqlite';
import { PersistenceError, databaseError } from './errors.js';
import {
  text,
  hash,
  integer,
  positive,
  sessionRow,
  validateSession,
  type StoredSession,
} from './rows.js';
export function sessionRepository(db: DatabaseSync) {
  return {
    insertSession(s: StoredSession) {
      try {
        validateSession(s);
        db.prepare(
          'INSERT INTO sessions(session_id,token_hash,nickname,created_at,expires_at,connection_generation) VALUES (?,?,?,?,?,?)',
        ).run(
          s.sessionId,
          s.tokenHash,
          s.nickname,
          s.createdAt,
          s.expiresAt,
          s.connectionGeneration,
        );
      } catch (error) {
        throw databaseError(error);
      }
    },
    findSessionByTokenHash(value: string) {
      try {
        const r = db.prepare('SELECT * FROM sessions WHERE token_hash=?').get(hash(value));
        return r ? sessionRow(r) : null;
      } catch (error) {
        throw databaseError(error);
      }
    },
    findSessionById(value: string) {
      try {
        const r = db.prepare('SELECT * FROM sessions WHERE session_id=?').get(text(value));
        return r ? sessionRow(r) : null;
      } catch (error) {
        throw databaseError(error);
      }
    },
    incrementSessionGeneration(input: {
      readonly sessionId: string;
      readonly expected: number;
      readonly now: number;
    }) {
      try {
        const id = text(input.sessionId),
          expected = positive(input.expected),
          now = integer(input.now),
          raw = db.prepare('SELECT * FROM sessions WHERE session_id=?').get(id);
        if (!raw) throw new PersistenceError('PERSISTENCE_SESSION_EXPIRED');
        const s = sessionRow(raw);
        if (s.expiresAt <= now) throw new PersistenceError('PERSISTENCE_SESSION_EXPIRED');
        if (s.connectionGeneration === Number.MAX_SAFE_INTEGER)
          throw new PersistenceError('PERSISTENCE_GENERATION_LIMIT');
        if (s.connectionGeneration !== expected) throw new PersistenceError('PERSISTENCE_CONFLICT');
        const updated = db
          .prepare(
            'UPDATE sessions SET connection_generation=connection_generation+1 WHERE session_id=? AND connection_generation=? AND expires_at>? RETURNING *',
          )
          .get(id, expected, now);
        if (!updated) throw new PersistenceError('PERSISTENCE_CONFLICT');
        return sessionRow(updated);
      } catch (error) {
        throw databaseError(error);
      }
    },
  };
}
