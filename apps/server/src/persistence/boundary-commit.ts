import type { DatabaseSync } from 'node:sqlite';
import type { BoundaryCommit } from './domain-rows.js';
import { fields, nullableInteger } from './rows.js';
import { withSqlTransaction } from './transaction.js';
import { writeRoomGraph } from './room-commit.js';
import { readHand } from './hand-repository.js';
import { invalid } from './errors.js';
export function commitBoundary(db: DatabaseSync, b: BoundaryCommit) {
  fields(b, [
    'expectedRoomVersion',
    'room',
    'participantWrites',
    'matchWrites',
    'ledger',
    'receipt',
    'failedRoomVersion',
  ]);
  nullableInteger(b.failedRoomVersion);
  if (
    b.failedRoomVersion !== null &&
    (b.expectedRoomVersion === null || b.failedRoomVersion !== b.expectedRoomVersion + 1)
  )
    invalid();
  return withSqlTransaction(db, () => {
    const hand = b.receipt.handId ? readHand(db, b.receipt.handId) : null;
    if (
      b.receipt.event !== 'internal:boundary' ||
      !hand ||
      hand.status !== 'settled' ||
      hand.roomId !== b.room.roomId ||
      hand.handId !== b.room.currentHandId ||
      hand.handVersion !== b.receipt.appliedHandVersion
    )
      invalid();
    writeRoomGraph(db, b, 0, true, undefined, b.failedRoomVersion ?? undefined);
  });
}
