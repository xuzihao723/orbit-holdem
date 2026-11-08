import type { DatabaseSync } from 'node:sqlite';
import type { HandResult } from '@orbit/protocol';
import { isCardId } from '@orbit/poker-core';
import {
  array,
  fields,
  text,
  integer,
  positive,
  nullableInteger,
  encode,
  json,
  seat,
  choice,
} from './rows.js';
import { invalid, PersistenceError } from './errors.js';
import { handGraph } from './hand-graph.js';
import type { HandRow, HandWrite } from './hand-rows.js';
function cardList(v: unknown, count?: number) {
  const cards = array(v).map((c) => {
    if (!isCardId(c)) invalid();
    return c;
  });
  if ((count !== undefined && cards.length !== count) || new Set(cards).size !== cards.length)
    invalid();
  return cards;
}
export function validateResult(result: HandResult, row: HandRow) {
  fields(result, [
    'roomId',
    'matchId',
    'handId',
    'handVersion',
    'phase',
    'board',
    'showdownCards',
    'pots',
    'refunds',
    'finalStacks',
    'reason',
  ]);
  if (
    result.roomId !== row.roomId ||
    result.matchId !== row.matchId ||
    result.handId !== row.handId ||
    result.handVersion !== row.handVersion ||
    result.phase !== 'settled'
  )
    invalid();
  choice(result.reason, ['showdown', 'allOthersFolded']);
  const visible = [...cardList(result.board)];
  if (![0, 3, 4, 5].includes(visible.length)) invalid();
  const ids = new Set<string>();
  for (const item of array(result.showdownCards)) {
    const p = fields(item, ['participantId', 'cards']),
      id = text(p.participantId);
    if (!row.participantIds.includes(id) || ids.has(id)) invalid();
    ids.add(id);
    visible.push(...cardList(p.cards, 2));
  }
  if (
    new Set(visible).size !== visible.length ||
    (result.reason === 'allOthersFolded' && ids.size !== 0)
  )
    invalid();
  const potIds = new Set<string>();
  for (const item of array(result.pots)) {
    const p = fields(item, [
      'potId',
      'amount',
      'eligibleParticipantIds',
      'winnerParticipantIds',
      'allocations',
      'winningCategory',
    ]);
    const id = text(p.potId);
    if (potIds.has(id)) invalid();
    potIds.add(id);
    const eligible = array(p.eligibleParticipantIds).map(text),
      winners = array(p.winnerParticipantIds).map(text);
    if (
      !eligible.length ||
      !winners.length ||
      new Set(eligible).size !== eligible.length ||
      new Set(winners).size !== winners.length ||
      eligible.some((id) => !row.participantIds.includes(id)) ||
      winners.some((id) => !eligible.includes(id))
    )
      invalid();
    if (p.winningCategory !== null && integer(p.winningCategory) > 8) invalid();
    if (result.reason === 'allOthersFolded' && p.winningCategory !== null) invalid();
    const allocations = array(p.allocations).map((v) => fields(v, ['participantId', 'amount']));
    if (
      allocations.length !== winners.length ||
      new Set(allocations.map((a) => text(a.participantId))).size !== winners.length ||
      allocations.some((a) => !winners.includes(text(a.participantId))) ||
      allocations.reduce((n, a) => n + integer(a.amount), 0) !== positive(p.amount)
    )
      invalid();
  }
  for (const item of array(result.refunds)) {
    const p = fields(item, ['participantId', 'amount']);
    if (!row.participantIds.includes(text(p.participantId))) invalid();
    positive(p.amount);
  }
  const final = array(result.finalStacks).map((v) =>
    fields(v, ['participantId', 'seatId', 'stack']),
  );
  if (
    final.length !== row.participantIds.length ||
    new Set(final.map((p) => text(p.participantId))).size !== final.length ||
    new Set(final.map((p) => seat(p.seatId))).size !== final.length ||
    final.some((p) => !row.participantIds.includes(text(p.participantId))) ||
    final.reduce((n, p) => n + integer(p.stack), 0) !== row.initialChipTotal
  )
    invalid();
}
export function validateHandRow(r: HandRow) {
  fields(r, [
    'handId',
    'roomId',
    'matchId',
    'startEpoch',
    'handVersion',
    'status',
    'participantIds',
    'startingStacks',
    'positions',
    'initialChipTotal',
    'result',
    'startedAt',
    'endedAt',
  ]);
  for (const v of [r.handId, r.roomId, r.matchId, r.startEpoch]) text(v);
  positive(r.handVersion);
  choice(r.status, ['active', 'settled', 'interrupted']);
  integer(r.initialChipTotal);
  integer(r.startedAt);
  nullableInteger(r.endedAt);
  const ids = array(r.participantIds).map(text);
  if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) invalid();
  const start = array(r.startingStacks).map((v) => fields(v, ['participantId', 'stack']));
  if (
    start.length !== ids.length ||
    new Set(start.map((p) => text(p.participantId))).size !== ids.length ||
    start.some((p) => !ids.includes(text(p.participantId))) ||
    start.reduce((n, p) => n + positive(p.stack), 0) !== r.initialChipTotal
  )
    invalid();
  fields(r.positions, [
    'dealerSeatId',
    'smallBlindSeatId',
    'bigBlindSeatId',
    'dealOrder',
    'preflopOrder',
    'postflopOrder',
  ]);
  if (
    (r.status === 'settled') !== (r.result !== null) ||
    (r.status === 'active') !== (r.endedAt === null) ||
    (r.endedAt !== null && r.endedAt < r.startedAt)
  )
    invalid();
  if (r.result) validateResult(r.result, r);
}
export function writeHandRow(db: DatabaseSync, write: HandWrite) {
  const r = write.row;
  validateHandRow(r);
  const values = [
    r.handId,
    r.roomId,
    r.matchId,
    r.startEpoch,
    r.handVersion,
    r.status,
    encode(r.participantIds),
    encode(r.startingStacks),
    encode(r.positions),
    r.initialChipTotal,
    r.result === null ? null : encode(r.result),
    r.startedAt,
    r.endedAt,
  ] as const;
  if (write.expectedVersion === null) {
    if (r.handVersion !== 1) invalid();
    db.prepare('INSERT INTO hands VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values);
  } else {
    const old = readHand(db, r.handId);
    if (
      !old ||
      old.status !== 'active' ||
      old.handVersion !== write.expectedVersion ||
      r.handVersion !== write.expectedVersion + 1 ||
      old.roomId !== r.roomId ||
      old.matchId !== r.matchId ||
      old.startEpoch !== r.startEpoch ||
      old.startedAt !== r.startedAt ||
      old.initialChipTotal !== r.initialChipTotal ||
      encode(old.participantIds) !== encode(r.participantIds) ||
      encode(old.startingStacks) !== encode(r.startingStacks) ||
      encode(old.positions) !== encode(r.positions)
    )
      throw new PersistenceError('PERSISTENCE_STALE_VERSION');
    const changed = db
      .prepare(
        'UPDATE hands SET hand_version=?,status=?,result_json=?,ended_at=? WHERE hand_id=? AND hand_version=?',
      )
      .run(
        r.handVersion,
        r.status,
        r.result === null ? null : encode(r.result),
        r.endedAt,
        r.handId,
        write.expectedVersion,
      );
    if (changed.changes !== 1) throw new PersistenceError('PERSISTENCE_STALE_VERSION');
  }
  const graph = handGraph(db, r.handId);
  if (r.result)
    for (const p of r.result.finalStacks)
      if (
        !graph.participants.some(
          (s) => s.participantId === p.participantId && s.seatId === p.seatId,
        )
      )
        invalid();
}
export function readHand(db: DatabaseSync, id: string): HandRow | null {
  const r = db.prepare('SELECT * FROM hands WHERE hand_id=?').get(text(id));
  if (!r) return null;
  const row: HandRow = {
    handId: text(r.hand_id),
    roomId: text(r.room_id),
    matchId: text(r.match_id),
    startEpoch: text(r.start_epoch),
    handVersion: integer(r.hand_version),
    status: choice(r.status, ['active', 'settled', 'interrupted']),
    participantIds: json(r.participant_ids_json) as string[],
    startingStacks: json(r.starting_stacks_json) as HandRow['startingStacks'],
    positions: json(r.positions_json) as HandRow['positions'],
    initialChipTotal: integer(r.initial_chip_total),
    result: r.result_json === null ? null : (json(r.result_json) as HandResult),
    startedAt: integer(r.started_at),
    endedAt: nullableInteger(r.ended_at),
  };
  validateHandRow(row);
  handGraph(db, id);
  return row;
}
