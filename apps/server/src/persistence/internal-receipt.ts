import type { DatabaseSync } from 'node:sqlite';
import {
  fields,
  text,
  integer,
  hash,
  nullableInteger,
  nullableText,
  json,
  type ReceiptInsert,
} from './rows.js';
import { invalid, databaseError } from './errors.js';
import { validateReceipt } from './payloads.js';
export interface InternalAppliedResult {
  kind: 'internalApplied';
  roomId: string;
  roomVersion: number;
  handId: string | null;
  handVersion: number | null;
}
export interface InternalReceiptInsert extends ReceiptInsert {
  event:
    | 'internal:timeout'
    | 'internal:boundary'
    | 'internal:leaveFold'
    | 'internal:expiry'
    | 'internal:bot'
    | 'internal:simulation';
  result: InternalAppliedResult;
}
export function validateInternalReceipt(r: ReceiptInsert): void {
  fields(r, [
    'actorScope',
    'commandId',
    'payloadHash',
    'event',
    'result',
    'roomId',
    'appliedRoomVersion',
    'handId',
    'appliedHandVersion',
    'createdAt',
  ]);
  const room = text(r.roomId),
    hand = nullableText(r.handId);
  integer(r.appliedRoomVersion);
  nullableInteger(r.appliedHandVersion);
  integer(r.createdAt);
  hash(r.payloadHash);
  if (
    (r.event === 'internal:bot'
      ? !/^bot:\S+$/.test(r.actorScope)
      : r.actorScope !== 'system:' + room) ||
    !(
      (r.event === 'internal:simulation' &&
        ((r.commandId === 'simulation:room:' + room &&
          hand === null &&
          r.appliedHandVersion === null) ||
          (text(r.commandId).startsWith('simulation:mode:' + room + ':') &&
            /^[1-9]\d*$/.test(r.commandId.slice(('simulation:mode:' + room + ':').length)) &&
            (hand === null) === (r.appliedHandVersion === null)) ||
          (hand !== null &&
            r.appliedHandVersion === 1 &&
            r.commandId === 'simulation:start:' + hand))) ||
      ((r.event === 'internal:timeout' || r.event === 'internal:leaveFold') &&
        hand !== null &&
        r.appliedHandVersion !== null &&
        text(r.commandId).startsWith(
          (r.event === 'internal:timeout' ? 'timeout:' : 'leave-fold:') + hand + ':',
        ) &&
        r.commandId.length >
          ((r.event === 'internal:timeout' ? 'timeout:' : 'leave-fold:') + hand + ':').length) ||
      (r.event === 'internal:boundary' &&
        hand !== null &&
        r.appliedHandVersion !== null &&
        r.commandId === 'boundary:' + hand) ||
      (r.event === 'internal:expiry' && /^expiry:[^:]+:[1-9]\d*:\d+$/.test(text(r.commandId))) ||
      (r.event === 'internal:bot' &&
        hand !== null &&
        r.appliedHandVersion !== null &&
        text(r.commandId).startsWith('bot:' + hand + ':') &&
        r.commandId.length > ('bot:' + hand + ':').length)
    )
  )
    invalid();
  const v = fields(r.result, ['kind', 'roomId', 'roomVersion', 'handId', 'handVersion']);
  if (
    v.kind !== 'internalApplied' ||
    v.roomId !== room ||
    v.roomVersion !== r.appliedRoomVersion ||
    v.handId !== hand ||
    v.handVersion !== r.appliedHandVersion
  )
    invalid();
}
export function validateStoredReceipt(r: ReceiptInsert): void {
  const event = Object.getOwnPropertyDescriptor(r, 'event');
  if (
    event &&
    'value' in event &&
    typeof event.value === 'string' &&
    event.value.startsWith('internal:')
  )
    validateInternalReceipt(r);
  else validateReceipt(r);
}
export function findInternalReceipt(
  db: DatabaseSync,
  actorScope: string,
  commandId: string,
): ReceiptInsert | null {
  try {
    if (!(
      (/^system:\S+$/.test(text(actorScope)) &&
        /^(timeout:|boundary:|leave-fold:|expiry:|simulation:)/.test(text(commandId))) ||
      (/^bot:\S+$/.test(text(actorScope)) && text(commandId).startsWith('bot:'))
    ))
      invalid();
    const raw = db
      .prepare('SELECT * FROM command_receipts WHERE actor_scope=? AND command_id=?')
      .get(actorScope, commandId);
    if (!raw) return null;
    const r: ReceiptInsert = {
      actorScope: text(raw.actor_scope),
      commandId: text(raw.command_id),
      payloadHash: text(raw.payload_hash),
      event: text(raw.event),
      result: json(raw.result_json),
      roomId: nullableText(raw.room_id),
      appliedRoomVersion: nullableInteger(raw.applied_room_version),
      handId: nullableText(raw.hand_id),
      appliedHandVersion: nullableInteger(raw.applied_hand_version),
      createdAt: integer(raw.created_at),
    };
    validateInternalReceipt(r);
    return Object.freeze(r);
  } catch (error) {
    throw databaseError(error);
  }
}
