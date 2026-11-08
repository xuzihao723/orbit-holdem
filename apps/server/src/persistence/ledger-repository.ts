import type { DatabaseSync } from 'node:sqlite';
import { databaseError, invalid } from './errors.js';
import {
  fields,
  text,
  integer,
  nullableText,
  scope,
  uuid,
  choice,
  type LedgerInsert,
} from './rows.js';
export function validateLedger(entry: LedgerInsert): void {
  fields(entry, [
    'entryId',
    'roomId',
    'matchId',
    'participantId',
    'type',
    'delta',
    'reason',
    'occurredAt',
    'sourceActorScope',
    'sourceCommandId',
    'sourceSystemEventId',
  ]);
  text(entry.entryId);
  text(entry.roomId);
  text(entry.matchId);
  text(entry.participantId);
  choice(entry.type, ['seat_grant', 'seat_cashout', 'match_reset_remove', 'match_reset_grant']);
  text(entry.reason);
  integer(entry.occurredAt);
  if (typeof entry.delta !== 'number' || !Number.isSafeInteger(entry.delta)) invalid();
  nullableText(entry.sourceActorScope);
  nullableText(entry.sourceCommandId);
  nullableText(entry.sourceSystemEventId);
  if (entry.sourceSystemEventId !== null) {
    if (entry.sourceActorScope !== null || entry.sourceCommandId !== null) invalid();
  } else {
    if (entry.sourceActorScope === null || entry.sourceCommandId === null) invalid();
    scope(entry.sourceActorScope);
    if (entry.sourceActorScope === 'system:' + entry.roomId) {
      const simulation =
        (entry.sourceCommandId === 'simulation:room:' + entry.roomId &&
          entry.type === 'seat_grant') ||
        (/^simulation:start:[^:]+$/.test(entry.sourceCommandId) &&
          ['match_reset_remove', 'match_reset_grant'].includes(entry.type));
      if (
        !simulation &&
        (!/^(boundary:[^:]+|expiry:[^:]+:[1-9]\d*:\d+)$/.test(entry.sourceCommandId) ||
          !['seat_grant', 'seat_cashout'].includes(entry.type))
      )
        invalid();
    } else uuid(entry.sourceCommandId);
  }
}
export function ledgerRepository(db: DatabaseSync) {
  return {
    appendLedger(entry: LedgerInsert) {
      try {
        validateLedger(entry);
        const p = db
          .prepare(
            'SELECT p.room_id,m.room_id AS match_room_id FROM participants p JOIN matches m ON m.match_id=? WHERE p.participant_id=?',
          )
          .get(entry.matchId, entry.participantId);
        if (!p || p.room_id !== entry.roomId || p.match_room_id !== entry.roomId) invalid();
        db.prepare('INSERT INTO chip_ledger VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
          entry.entryId,
          entry.roomId,
          entry.matchId,
          entry.participantId,
          entry.type,
          entry.delta,
          entry.reason,
          entry.occurredAt,
          entry.sourceActorScope,
          entry.sourceCommandId,
          entry.sourceSystemEventId,
        );
      } catch (error) {
        throw databaseError(error);
      }
    },
    listLedger(roomId: string): readonly LedgerInsert[] {
      try {
        return Object.freeze(
          db
            .prepare('SELECT * FROM chip_ledger WHERE room_id=? ORDER BY occurred_at,entry_id')
            .all(text(roomId))
            .map((r) => {
              const e: LedgerInsert = {
                entryId: text(r.entry_id),
                roomId: text(r.room_id),
                matchId: text(r.match_id),
                participantId: text(r.participant_id),
                type: choice(r.type, [
                  'seat_grant',
                  'seat_cashout',
                  'match_reset_remove',
                  'match_reset_grant',
                ]),
                delta: typeof r.delta === 'number' ? r.delta : NaN,
                reason: text(r.reason),
                occurredAt: integer(r.occurred_at),
                sourceActorScope: nullableText(r.source_actor_scope),
                sourceCommandId: nullableText(r.source_command_id),
                sourceSystemEventId: nullableText(r.source_system_event_id),
              };
              validateLedger(e);
              return Object.freeze(e);
            }),
        );
      } catch (error) {
        throw databaseError(error);
      }
    },
  };
}
