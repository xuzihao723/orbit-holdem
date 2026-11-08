import { validateStoredReceipt } from './internal-receipt.js';
import type { HandWrite } from './hand-rows.js';
import { writeHandRow } from './hand-repository.js';
import { writeHandEvents } from './hand-events.js';
import type { Capacity } from '@orbit/protocol';
import type { DatabaseSync } from 'node:sqlite';
import type { RoomRow, ParticipantRow, MatchRow, RoomCommit } from './domain-rows.js';
import {
  fields,
  boolean,
  encode,
  text,
  integer,
  nullableInteger,
  nullableText,
  seat,
  choice,
  array,
} from './rows.js';
import { invalid, PersistenceError } from './errors.js';
import { withSqlTransaction } from './transaction.js';
import { writeReceipt } from './command-writes.js';
import { validateReceipt } from './payloads.js';
import { ledgerRepository, validateLedger } from './ledger-repository.js';
export class RoomCodeCollision extends PersistenceError {
  constructor() {
    super('PERSISTENCE_CONFLICT');
  }
}
export function capacity(v: unknown): Capacity {
  if (v !== 2 && v !== 3 && v !== 4) invalid();
  return v;
}
export function validateRoom(r: RoomRow) {
  fields(r, [
    'roomId',
    'roomCode',
    'capacity',
    'status',
    'roomVersion',
    'serverEpoch',
    'hostParticipantId',
    'matchId',
    'currentHandId',
    'createdAt',
    'closedAt',
    'resetProposal',
  ]);
  if (r.resetProposal !== null) {
    const p = fields(r.resetProposal, ['proposedByParticipantId', 'proposedAt']);
    text(p.proposedByParticipantId);
    integer(p.proposedAt);
    if (p.proposedByParticipantId !== r.hostParticipantId) invalid();
  }
  text(r.roomId);
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(text(r.roomCode))) invalid();
  capacity(r.capacity);
  choice(r.status, [
    'waiting',
    'playing',
    'betweenHands',
    'matchFinished',
    'pausedFault',
    'closed',
  ]);
  integer(r.roomVersion);
  text(r.serverEpoch);
  nullableText(r.hostParticipantId);
  nullableText(r.matchId);
  nullableText(r.currentHandId);
  integer(r.createdAt);
  nullableInteger(r.closedAt);
  if (r.closedAt !== null && r.closedAt < r.createdAt) invalid();
}
export function validateParticipant(p: ParticipantRow) {
  fields(p, [
    'participantId',
    'roomId',
    'sessionId',
    'botId',
    'seatId',
    'nickname',
    'stack',
    'admission',
    'joinedAt',
    'leftAt',
    'ready',
    'botDifficulty',
  ]);
  boolean(p.ready);
  if (p.botDifficulty !== null) choice(p.botDifficulty, ['basic', 'standard']);
  if ((p.sessionId === null) !== (p.botDifficulty !== null) || (p.botId !== null && p.ready))
    invalid();
  text(p.participantId);
  text(p.roomId);
  nullableText(p.sessionId);
  nullableText(p.botId);
  if ((p.sessionId === null) === (p.botId === null)) invalid();
  seat(p.seatId);
  text(p.nickname);
  integer(p.stack);
  choice(p.admission, ['waitingNextHand', 'active', 'eliminated', 'leaving']);
  integer(p.joinedAt);
  nullableInteger(p.leftAt);
  if (p.leftAt !== null && p.leftAt < p.joinedAt) invalid();
}
export function validateMatch(m: MatchRow) {
  fields(m, ['matchId', 'roomId', 'status', 'lastBigBlindSeatId', 'startedAt', 'endedAt']);
  text(m.matchId);
  text(m.roomId);
  choice(m.status, ['active', 'finished', 'interrupted']);
  if (m.lastBigBlindSeatId !== null) seat(m.lastBigBlindSeatId);
  integer(m.startedAt);
  nullableInteger(m.endedAt);
  if (m.endedAt !== null && m.endedAt < m.startedAt) invalid();
}
export function writeRoomGraph(
  db: DatabaseSync,
  b: RoomCommit,
  adjustment = 0,
  checkLedgerPerParticipant = true,
  handWrite?: HandWrite,
  boundaryFaultVersion?: number,
) {
  if (
    boundaryFaultVersion !== undefined &&
    (b.receipt.event !== 'internal:boundary' ||
      handWrite !== undefined ||
      b.expectedRoomVersion === null ||
      boundaryFaultVersion !== b.expectedRoomVersion + 1 ||
      b.room.roomVersion !== boundaryFaultVersion + 1)
  )
    invalid();
  validateRoom(b.room);
  const r = b.room;
  nullableInteger(b.expectedRoomVersion);
  array(b.participantWrites);
  array(b.matchWrites);
  array(b.ledger);
  b.ledger.forEach(validateLedger);
  validateStoredReceipt(b.receipt);
  const old = db.prepare('SELECT * FROM rooms WHERE room_id=?').get(r.roomId);
  if (b.expectedRoomVersion === null) {
    if (old || r.roomVersion !== 1) invalid();
    if (
      db.prepare("SELECT room_id FROM rooms WHERE room_code=? AND status<>'closed'").get(r.roomCode)
    )
      throw new RoomCodeCollision();
  } else if (
    !old ||
    old.room_version !== b.expectedRoomVersion ||
    (r.roomVersion !== b.expectedRoomVersion + 1 &&
      !(boundaryFaultVersion !== undefined && r.roomVersion === boundaryFaultVersion + 1) &&
      !(
        handWrite !== undefined &&
        handWrite.expectedVersion !== null &&
        r.roomVersion === b.expectedRoomVersion
      )) ||
    r.roomCode !== old.room_code ||
    r.serverEpoch !== old.server_epoch ||
    r.createdAt !== old.created_at
  )
    throw new PersistenceError('PERSISTENCE_STALE_VERSION');
  const before = db.prepare('SELECT * FROM participants WHERE room_id=?').all(r.roomId),
    combined = new Map<
      string,
      {
        participantId: string;
        seatId: import('@orbit/protocol').SeatId;
        sessionId: string | null;
        stack: number;
        leftAt: number | null;
      }
    >(
      before.map((p) => [
        text(p.participant_id),
        {
          participantId: text(p.participant_id),
          seatId: seat(p.seat_id),
          sessionId: nullableText(p.session_id),
          stack: integer(p.stack),
          leftAt: nullableInteger(p.left_at),
        },
      ]),
    );
  const ids = new Set<string>();
  for (const p of b.participantWrites) {
    validateParticipant(p);
    if (p.roomId !== r.roomId || ids.has(p.participantId)) invalid();
    ids.add(p.participantId);
    const prior = db
      .prepare('SELECT * FROM participants WHERE participant_id=?')
      .get(p.participantId);
    if (
      prior &&
      (prior.room_id !== p.roomId ||
        prior.session_id !== p.sessionId ||
        prior.bot_id !== p.botId ||
        prior.seat_id !== p.seatId ||
        prior.joined_at !== p.joinedAt ||
        prior.nickname !== p.nickname ||
        (prior.left_at !== null && prior.left_at !== p.leftAt))
    )
      invalid();
    combined.set(p.participantId, {
      participantId: p.participantId,
      seatId: p.seatId,
      sessionId: p.sessionId,
      stack: p.stack,
      leftAt: p.leftAt,
    });
  }
  const current = [...combined.values()].filter((p) => p.leftAt === null);
  if (
    current.length > r.capacity ||
    new Set(current.map((p) => p.seatId)).size !== current.length ||
    new Set(current.filter((p) => p.sessionId !== null).map((p) => p.sessionId)).size !==
      current.filter((p) => p.sessionId !== null).length
  )
    invalid();
  if (
    r.hostParticipantId !== null &&
    !current.some((p) => p.participantId === r.hostParticipantId && p.sessionId !== null)
  )
    invalid();
  const matchIds = new Set<string>();
  for (const m of b.matchWrites) {
    validateMatch(m);
    if (matchIds.has(m.matchId)) invalid();
    matchIds.add(m.matchId);
    if (m.roomId !== r.roomId) invalid();
    const prior = db.prepare('SELECT * FROM matches WHERE match_id=?').get(m.matchId);
    if (prior && (prior.room_id !== m.roomId || prior.started_at !== m.startedAt)) invalid();
  }
  if (old && r.roomVersion === b.expectedRoomVersion) {
    if (
      r.capacity !== old.capacity ||
      r.status !== old.status ||
      r.hostParticipantId !== old.host_participant_id ||
      r.matchId !== old.match_id ||
      r.currentHandId !== old.current_hand_id ||
      (r.resetProposal === null ? null : encode(r.resetProposal)) !== old.reset_proposal_json ||
      combined.size !== before.length
    )
      invalid();
    for (const p of b.participantWrites) {
      const oldP = before.find((v) => v.participant_id === p.participantId);
      if (
        !oldP ||
        p.stack !== oldP.stack ||
        p.admission !== oldP.admission ||
        p.leftAt !== oldP.left_at ||
        (p.ready ? 1 : 0) !== oldP.ready ||
        p.botDifficulty !== oldP.bot_difficulty
      )
        invalid();
    }
  }
  const ledgerDelta = b.ledger.reduce((n, e) => {
    if (
      e.roomId !== r.roomId ||
      e.sourceActorScope !== b.receipt.actorScope ||
      e.sourceCommandId !== b.receipt.commandId ||
      e.sourceSystemEventId !== null
    )
      invalid();
    return n + e.delta;
  }, 0);
  const beforeTotal = before.reduce((n, p) => n + integer(p.stack), 0),
    afterTotal = [...combined.values()].reduce((n, p) => n + p.stack, 0);
  if (
    !Number.isSafeInteger(ledgerDelta) ||
    !Number.isSafeInteger(afterTotal) ||
    beforeTotal + ledgerDelta !== afterTotal + adjustment
  )
    invalid();
  if (checkLedgerPerParticipant)
    for (const [id, p] of combined) {
      const oldStack = before.find((v) => v.participant_id === id)?.stack ?? 0;
      const delta = b.ledger.filter((e) => e.participantId === id).reduce((n, e) => n + e.delta, 0);
      if (p.stack - integer(oldStack) !== delta) invalid();
    }
  if (b.receipt.roomId !== r.roomId || b.receipt.appliedRoomVersion !== r.roomVersion) invalid();
  if (!old)
    db.prepare(
      'INSERT INTO rooms(room_id,room_code,capacity,status,room_version,server_epoch,host_participant_id,match_id,current_hand_id,created_at,closed_at,reset_proposal_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      r.roomId,
      r.roomCode,
      r.capacity,
      r.status,
      r.roomVersion,
      r.serverEpoch,
      r.hostParticipantId,
      r.matchId,
      r.currentHandId,
      r.createdAt,
      r.closedAt,
      r.resetProposal === null ? null : encode(r.resetProposal),
    );
  else
    db.prepare(
      'UPDATE rooms SET capacity=?,status=?,room_version=?,host_participant_id=?,match_id=?,current_hand_id=?,closed_at=?,reset_proposal_json=? WHERE room_id=?',
    ).run(
      r.capacity,
      r.status,
      r.roomVersion,
      r.hostParticipantId,
      r.matchId,
      r.currentHandId,
      r.closedAt,
      r.resetProposal === null ? null : encode(r.resetProposal),
      r.roomId,
    );
  for (const m of b.matchWrites)
    db.prepare(
      'INSERT INTO matches VALUES (?,?,?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET status=excluded.status,last_big_blind_seat_id=excluded.last_big_blind_seat_id,ended_at=excluded.ended_at',
    ).run(m.matchId, m.roomId, m.status, m.lastBigBlindSeatId, m.startedAt, m.endedAt);
  for (const p of b.participantWrites)
    db.prepare(
      'INSERT INTO participants(participant_id,room_id,session_id,bot_id,seat_id,nickname,stack,admission,joined_at,left_at,ready,bot_difficulty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(participant_id) DO UPDATE SET stack=excluded.stack,admission=excluded.admission,left_at=excluded.left_at,ready=excluded.ready,bot_difficulty=excluded.bot_difficulty',
    ).run(
      p.participantId,
      p.roomId,
      p.sessionId,
      p.botId,
      p.seatId,
      p.nickname,
      p.stack,
      p.admission,
      p.joinedAt,
      p.leftAt,
      p.ready ? 1 : 0,
      p.botDifficulty,
    );
  if (handWrite) {
    writeHandRow(db, handWrite);
    writeHandEvents(db, handWrite.row.handId, handWrite.row.handVersion, handWrite.events);
  }
  if (
    r.matchId !== null &&
    !db.prepare('SELECT 1 FROM matches WHERE match_id=? AND room_id=?').get(r.matchId, r.roomId)
  )
    invalid();
  if (
    r.currentHandId !== null &&
    !db
      .prepare('SELECT 1 FROM hands WHERE hand_id=? AND room_id=? AND match_id=?')
      .get(r.currentHandId, r.roomId, r.matchId)
  )
    invalid();
  writeReceipt(db, b.receipt);
  for (const e of b.ledger) ledgerRepository(db).appendLedger(e);
}
export function commitRoomChange(db: DatabaseSync, b: RoomCommit) {
  fields(b, [
    'expectedRoomVersion',
    'room',
    'participantWrites',
    'matchWrites',
    'ledger',
    'receipt',
  ]);
  withSqlTransaction(db, () => writeRoomGraph(db, b));
}
