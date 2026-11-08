import type { DatabaseSync } from 'node:sqlite';
import { resolvePositions } from '@orbit/poker-core';
import { invalid } from './errors.js';
import {
  object,
  text,
  integer,
  positive,
  fields,
  array,
  json,
  seat,
  seatList,
  choice,
} from './rows.js';
export function handGraph(db: DatabaseSync, handId: string) {
  const raw = db
    .prepare(
      'SELECT h.*,m.room_id AS match_room_id FROM hands h JOIN matches m ON m.match_id=h.match_id WHERE h.hand_id=?',
    )
    .get(text(handId));
  if (!raw) invalid();
  const r = object(raw),
    roomId = text(r.room_id);
  if (r.match_room_id !== roomId) invalid();
  const ids = array(json(r.participant_ids_json)).map(text);
  if (ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) invalid();
  const participants = ids.map((id) => {
    const p = db
      .prepare('SELECT participant_id,room_id,seat_id FROM participants WHERE participant_id=?')
      .get(id);
    if (!p || p.room_id !== roomId) invalid();
    return { participantId: text(p.participant_id), seatId: seat(p.seat_id) };
  });
  if (new Set(participants.map((p) => p.seatId)).size !== participants.length) invalid();
  const starting = array(json(r.starting_stacks_json)).map((value) => {
    const p = fields(value, ['participantId', 'stack']);
    return { participantId: text(p.participantId), stack: positive(p.stack) };
  });
  if (
    starting.length !== ids.length ||
    new Set(starting.map((p) => p.participantId)).size !== ids.length ||
    starting.some((p) => !ids.includes(p.participantId)) ||
    starting.reduce((s, p) => s + p.stack, 0) !== integer(r.initial_chip_total)
  )
    invalid();
  const positions = fields(json(r.positions_json), [
      'dealerSeatId',
      'smallBlindSeatId',
      'bigBlindSeatId',
      'dealOrder',
      'preflopOrder',
      'postflopOrder',
    ]),
    expected = resolvePositions(
      participants.map((p) => p.seatId),
      seat(positions.dealerSeatId),
    );
  for (const key of ['dealerSeatId', 'smallBlindSeatId', 'bigBlindSeatId'] as const)
    if (seat(positions[key]) !== expected[key]) invalid();
  for (const key of ['dealOrder', 'preflopOrder', 'postflopOrder'] as const)
    if (JSON.stringify(seatList(positions[key])) !== JSON.stringify(expected[key])) invalid();
  return {
    handId: text(r.hand_id),
    roomId,
    version: integer(r.hand_version),
    status: choice(r.status, ['active', 'settled', 'interrupted']),
    participants,
    dealerSeatId: expected.dealerSeatId,
  };
}
