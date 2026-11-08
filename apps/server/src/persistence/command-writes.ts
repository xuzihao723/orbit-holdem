import type { DatabaseSync } from 'node:sqlite';
import type { ReceiptInsert } from './rows.js';
import { encode } from './rows.js';
import { validateStoredReceipt } from './internal-receipt.js';
export function writeReceipt(db: DatabaseSync, r: ReceiptInsert) {
  validateStoredReceipt(r);
  db.prepare(
    'INSERT INTO command_receipts(actor_scope,command_id,payload_hash,event,result_json,room_id,applied_room_version,hand_id,applied_hand_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(
    r.actorScope,
    r.commandId,
    r.payloadHash,
    r.event,
    encode(r.result),
    r.roomId,
    r.appliedRoomVersion,
    r.handId,
    r.appliedHandVersion,
    r.createdAt,
  );
}
