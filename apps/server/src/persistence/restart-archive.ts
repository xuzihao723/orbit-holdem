import type { DatabaseSync } from 'node:sqlite';
import { fields, text, integer } from './rows.js';
import { withSqlTransaction } from './transaction.js';
/** Archive only lifecycle metadata. Never fabricate settlement or ledger entries. */
export function archivePreviousEpoch(
  db: DatabaseSync,
  input: { serverEpoch: string; now: number },
) {
  fields(input, ['serverEpoch', 'now']);
  text(input.serverEpoch);
  integer(input.now);
  return withSqlTransaction(db, () => {
    const rooms = db
      .prepare("SELECT room_id,created_at FROM rooms WHERE server_epoch<>? AND status<>'closed'")
      .all(input.serverEpoch);
    for (const room of rooms) {
      const id = text(room.room_id),
        at = Math.max(input.now, integer(room.created_at));
      db.prepare(
        "UPDATE hands SET status='interrupted',ended_at=MAX(started_at,?) WHERE room_id=? AND status='active'",
      ).run(at, id);
      db.prepare(
        "UPDATE matches SET status='interrupted',ended_at=MAX(started_at,?) WHERE room_id=? AND status='active'",
      ).run(at, id);
      db.prepare(
        'UPDATE participants SET left_at=MAX(joined_at,?),ready=0 WHERE room_id=? AND left_at IS NULL',
      ).run(at, id);
      db.prepare(
        "UPDATE rooms SET status='closed',closed_at=?,reset_proposal_json=NULL,room_version=room_version+1 WHERE room_id=?",
      ).run(at, id);
    }
    return { archivedRooms: rooms.length };
  });
}
