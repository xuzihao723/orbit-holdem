import { validateStoredReceipt } from './internal-receipt.js';
import type { DatabaseSync } from 'node:sqlite';
import { fields, array, object, integer } from './rows.js';
import { invalid } from './errors.js';
import { withSqlTransaction } from './transaction.js';
import { writeRoomGraph } from './room-commit.js';
import { validateHandRow } from './hand-repository.js';
import { validateParticipant, validateRoom, validateMatch } from './room-commit.js';
import { validateLedger } from './ledger-repository.js';
import type { ParticipantRow, MatchRow } from './domain-rows.js';
import type { LedgerInsert } from './rows.js';
import { validateEvent, validateReceipt } from './payloads.js';
import type { HandStartCommit } from './hand-rows.js';
import { validateResultBalances } from './result-balances.js';
export function commitHandStart(db: DatabaseSync, b: HandStartCommit) {
  fields(b, [
    'expectedRoomVersion',
    'room',
    'participantWrites',
    'matchWrites',
    'ledger',
    'receipt',
    'hand',
    'events',
  ]);
  validateHandRow(b.hand);
  array(b.events).forEach((e) => validateEvent(e as import('./rows.js').EventInsert));
  validateRoom(b.room);
  array(b.participantWrites).forEach((p) => validateParticipant(p as ParticipantRow));
  array(b.matchWrites).forEach((m) => validateMatch(m as MatchRow));
  array(b.ledger).forEach((e) => validateLedger(e as LedgerInsert));
  validateStoredReceipt(b.receipt);
  validateResultBalances(b.hand, b.participantWrites);
  withSqlTransaction(db, () => {
    if (
      b.hand.roomId !== b.room.roomId ||
      b.hand.matchId !== b.room.matchId ||
      b.hand.handId !== b.room.currentHandId ||
      b.hand.handId !== b.receipt.handId ||
      b.hand.handVersion !== b.receipt.appliedHandVersion
    )
      invalid();
    const before = db.prepare('SELECT * FROM participants WHERE room_id=?').all(b.room.roomId);
    for (const p of b.participantWrites) {
      const old = before.find((v) => v.participant_id === p.participantId),
        funds = b.ledger
          .filter((e) => e.participantId === p.participantId)
          .reduce((n, e) => n + e.delta, 0),
        start = b.hand.startingStacks.find((s) => s.participantId === p.participantId);
      if (start && (old ? integer(old.stack) : 0) + funds !== start.stack) invalid();
      let eventDelta = 0;
      for (const e of b.events) {
        const payload = object(e.payload);
        if (payload.seatId !== p.seatId) continue;
        if (e.kind === 'blindPosted') eventDelta -= integer(payload.amount);
        if (e.kind === 'refunded' || e.kind === 'paidOut') eventDelta += integer(payload.amount);
      }
      if (p.stack !== (start ? start.stack + eventDelta : (old ? integer(old.stack) : 0) + funds))
        invalid();
    }
    const adjustment =
      b.hand.initialChipTotal -
      b.participantWrites
        .filter((p) => b.hand.participantIds.includes(p.participantId))
        .reduce((n, p) => n + p.stack, 0);
    writeRoomGraph(db, b, adjustment, false, {
      row: b.hand,
      expectedVersion: null,
      events: b.events,
    });
  });
}
