import type { DatabaseSync } from 'node:sqlite';
import { validateEvent } from './payloads.js';
import { handGraph } from './hand-graph.js';
import { array, object, integer, encode, type EventInsert } from './rows.js';
import { invalid, PersistenceError } from './errors.js';
export function writeHandEvents(
  db: DatabaseSync,
  handId: string,
  version: number,
  events: readonly EventInsert[],
) {
  array(events);
  const graph = handGraph(db, handId);
  let sequence = integer(
    db.prepare('SELECT COALESCE(MAX(sequence),0) n FROM hand_events WHERE hand_id=?').get(handId)
      ?.n,
  );
  const member = (id: unknown) => graph.participants.some((p) => p.seatId === id);
  for (const e of events) {
    validateEvent(e);
    if (e.handId !== handId || e.handVersion !== version || e.sequence !== sequence + 1)
      throw new PersistenceError('PERSISTENCE_CONFLICT');
    sequence = e.sequence;
    const p = object(e.payload);
    if (Object.hasOwn(p, 'seatId') && !member(p.seatId)) invalid();
    if (
      e.ownerParticipantId !== null &&
      !graph.participants.some(
        (v) => v.participantId === e.ownerParticipantId && v.seatId === p.seatId,
      )
    )
      invalid();
    if (
      e.kind === 'handStarted' &&
      (p.dealerSeatId !== graph.dealerSeatId ||
        encode([...array(p.seats)].sort()) !==
          encode(graph.participants.map((v) => v.seatId).sort()))
    )
      invalid();
    if (e.kind === 'showdownRevealed' && array(p.cards).some((v) => !member(object(v).seatId)))
      invalid();
    if (
      e.kind === 'potsBuilt' &&
      array(p.pots).some((v) =>
        ['contributorSeatIds', 'eligibleSeatIds', 'winnerSeatIds'].some((k) =>
          array(object(v)[k]).some((id) => !member(id)),
        ),
      )
    )
      invalid();
    db.prepare('INSERT INTO hand_events VALUES (?,?,?,?,?,?,?,?)').run(
      e.handId,
      e.sequence,
      e.handVersion,
      e.kind,
      encode(e.payload),
      e.visibility,
      e.ownerParticipantId,
      e.occurredAt,
    );
  }
}
