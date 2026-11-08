import { validateStoredReceipt } from './internal-receipt.js';
import type { DatabaseSync } from 'node:sqlite';
import type { HandActionCommit } from './hand-rows.js';
import type { ParticipantRow, MatchRow } from './domain-rows.js';
import { fields, array, integer } from './rows.js';
import { withSqlTransaction } from './transaction.js';
import { invalid, PersistenceError } from './errors.js';
import { validateHandRow, readHand } from './hand-repository.js';
import { validateRoom, validateParticipant, validateMatch, writeRoomGraph } from './room-commit.js';
import { validateEvent, validateReceipt } from './payloads.js';
import { eventStackDelta } from './hand-accounting.js';
import { validateResultBalances } from './result-balances.js';
export function commitHandAction(db: DatabaseSync, b: HandActionCommit) {
  fields(b, [
    'expectedRoomVersion',
    'room',
    'participantWrites',
    'matchWrites',
    'ledger',
    'receipt',
    'hand',
    'events',
    'expectedHandVersion',
  ]);
  validateRoom(b.room);
  validateHandRow(b.hand);
  validateStoredReceipt(b.receipt);
  integer(b.expectedHandVersion);
  array(b.events).forEach((e) => validateEvent(e as import('./rows.js').EventInsert));
  array(b.participantWrites).forEach((p) => validateParticipant(p as ParticipantRow));
  array(b.matchWrites).forEach((m) => validateMatch(m as MatchRow));
  if (array(b.ledger).length) invalid();
  validateResultBalances(b.hand, b.participantWrites);
  withSqlTransaction(db, () => {
    const old = readHand(db, b.hand.handId);
    if (
      !old ||
      old.status !== 'active' ||
      old.handVersion !== b.expectedHandVersion ||
      b.hand.handVersion !== b.expectedHandVersion + 1
    )
      throw new PersistenceError('PERSISTENCE_STALE_VERSION');
    if (
      b.hand.status === 'interrupted' ||
      b.hand.roomId !== b.room.roomId ||
      b.hand.matchId !== b.room.matchId ||
      b.hand.handId !== b.room.currentHandId ||
      b.hand.handId !== b.receipt.handId ||
      b.hand.handVersion !== b.receipt.appliedHandVersion
    )
      invalid();
    const before = db
      .prepare('SELECT participant_id,stack,seat_id FROM participants WHERE room_id=?')
      .all(b.room.roomId);
    if (
      new Set(b.participantWrites.map((p) => p.participantId)).size !== b.participantWrites.length
    )
      invalid();
    for (const p of b.participantWrites) {
      const prev = before.find((v) => v.participant_id === p.participantId);
      if (!prev) invalid();
      const delta = old.participantIds.includes(p.participantId)
        ? eventStackDelta(b.events, p.seatId)
        : 0;
      if (p.stack !== integer(prev.stack) + delta) invalid();
    }
    for (const id of old.participantIds)
      if (!b.participantWrites.some((p) => p.participantId === id)) invalid();
    const oldPot =
      old.initialChipTotal -
      before
        .filter((p) => old.participantIds.includes(String(p.participant_id)))
        .reduce((n, p) => n + integer(p.stack), 0);
    const newPot =
      b.hand.initialChipTotal -
      b.participantWrites
        .filter((p) => b.hand.participantIds.includes(p.participantId))
        .reduce((n, p) => n + p.stack, 0);
    integer(oldPot);
    integer(newPot);
    writeRoomGraph(db, b, newPot - oldPot, false, {
      row: b.hand,
      expectedVersion: b.expectedHandVersion,
      events: b.events,
    });
  });
}
