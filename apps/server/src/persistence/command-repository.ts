import { writeReceipt } from './command-writes.js';
import type { DatabaseSync } from 'node:sqlite';
import { withSqlTransaction } from './transaction.js';
import { databaseError, invalid, PersistenceError } from './errors.js';
import {
  fields,
  text,
  integer,
  positive,
  nullableInteger,
  nullableText,
  encode,
  json,
  object,
  uuid,
  scope,
  array,
  type AppliedBatch,
  type ReceiptInsert,
} from './rows.js';
import { validateEvent, validateReceipt } from './payloads.js';
import { handGraph } from './hand-graph.js';
export function commandRepository(db: DatabaseSync) {
  return {
    commitAppliedCommand(batch: AppliedBatch) {
      try {
        fields(batch, ['events', 'receipt', 'handVersionUpdate']);
        if (!Array.isArray(batch.events)) invalid();
        array(batch.events);
        validateReceipt(batch.receipt);
        for (const event of batch.events) validateEvent(event);
        withSqlTransaction(db, () => {
          const update = batch.handVersionUpdate;
          if (update === null) {
            if (batch.events.length || batch.receipt.handId !== null) invalid();
          } else {
            fields(update, ['handId', 'expected', 'next']);
            text(update.handId);
            integer(update.expected);
            positive(update.next);
            if (
              update.next !== update.expected + 1 ||
              !Number.isSafeInteger(update.next) ||
              batch.receipt.handId !== update.handId ||
              batch.receipt.appliedHandVersion !== update.next
            )
              invalid();
            const graph = handGraph(db, update.handId);
            if (graph.status !== 'active' || graph.version !== update.expected)
              throw new PersistenceError('PERSISTENCE_STALE_VERSION');
            if (batch.receipt.roomId !== graph.roomId) invalid();
            let sequence = integer(
              db
                .prepare(
                  'SELECT COALESCE(MAX(sequence),0) AS sequence FROM hand_events WHERE hand_id=?',
                )
                .get(update.handId)?.sequence,
            );
            for (const event of batch.events) {
              if (
                event.handId !== graph.handId ||
                event.handVersion !== update.next ||
                event.sequence !== sequence + 1
              )
                throw new PersistenceError('PERSISTENCE_CONFLICT');
              sequence = event.sequence;
              if (event.ownerParticipantId !== null) {
                const owner = graph.participants.find(
                  (p) => p.participantId === event.ownerParticipantId,
                );
                if (!owner || object(event.payload).seatId !== owner.seatId) invalid();
              }
              const payload = object(event.payload);
              if (
                Object.hasOwn(payload, 'seatId') &&
                !graph.participants.some((p) => p.seatId === payload.seatId)
              )
                invalid();
              const member = (value: unknown) => graph.participants.some((p) => p.seatId === value);
              if (
                event.kind === 'handStarted' &&
                (payload.dealerSeatId !== graph.dealerSeatId ||
                  JSON.stringify([...array(payload.seats)].sort()) !==
                    JSON.stringify(graph.participants.map((p) => p.seatId).sort()))
              )
                invalid();
              if (
                event.kind === 'showdownRevealed' &&
                array(payload.cards).some((value) => !member(object(value).seatId))
              )
                invalid();
              if (
                event.kind === 'potsBuilt' &&
                array(payload.pots).some((value) => {
                  const pot = object(value);
                  return ['contributorSeatIds', 'eligibleSeatIds', 'winnerSeatIds'].some((key) =>
                    array(pot[key]).some((id) => !member(id)),
                  );
                })
              )
                invalid();
              db.prepare(
                'INSERT INTO hand_events(hand_id,sequence,hand_version,kind,payload_json,visibility,owner_participant_id,occurred_at) VALUES (?,?,?,?,?,?,?,?)',
              ).run(
                event.handId,
                event.sequence,
                event.handVersion,
                event.kind,
                encode(event.payload),
                event.visibility,
                event.ownerParticipantId,
                event.occurredAt,
              );
            }
          }
          writeReceipt(db, batch.receipt);
          if (update) {
            const r = db
              .prepare('UPDATE hands SET hand_version=? WHERE hand_id=? AND hand_version=?')
              .run(update.next, update.handId, update.expected);
            if (r.changes !== 1) throw new PersistenceError('PERSISTENCE_STALE_VERSION');
          }
        });
      } catch (error) {
        throw databaseError(error);
      }
    },
    findReceipt(actorScope: string, commandId: string): ReceiptInsert | null {
      try {
        const raw = db
          .prepare('SELECT * FROM command_receipts WHERE actor_scope=? AND command_id=?')
          .get(scope(actorScope), uuid(commandId));
        if (!raw) return null;
        const r = object(raw),
          receipt: ReceiptInsert = {
            actorScope: text(r.actor_scope),
            commandId: text(r.command_id),
            payloadHash: text(r.payload_hash),
            event: text(r.event),
            result: json(r.result_json),
            roomId: nullableText(r.room_id),
            appliedRoomVersion: nullableInteger(r.applied_room_version),
            handId: nullableText(r.hand_id),
            appliedHandVersion: nullableInteger(r.applied_hand_version),
            createdAt: integer(r.created_at),
          };
        validateReceipt(receipt);
        return Object.freeze(receipt);
      } catch (error) {
        throw databaseError(error);
      }
    },
  };
}
