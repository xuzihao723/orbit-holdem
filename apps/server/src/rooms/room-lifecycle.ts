import { randomUUID } from 'node:crypto';
import type { AuthenticatedCommand } from '../transport/types.js';
import type { ParticipantRow } from '../persistence/domain-rows.js';
import type { LedgerInsert } from '../persistence/rows.js';
import { RoomError, nextVersion, type RoomState } from './room-types.js';
export interface LedgerEffect {
  participantId: string;
  matchId: string;
  type: LedgerInsert['type'];
  delta: number;
}
export interface ManagementCandidate {
  state: RoomState;
  ledger: LedgerEffect[];
  changed: boolean;
}
export function prepareManagement(
  c: AuthenticatedCommand,
  state: RoomState,
  member: ParticipantRow,
  now: number,
): ManagementCandidate {
  if (
    c.event === 'game:action' ||
    c.event === 'room:create' ||
    c.event === 'room:join' ||
    c.event === 'room:leave'
  )
    throw new RoomError('INVALID_INPUT');
  if (c.event !== 'room:ready' && member.participantId !== state.row.hostParticipantId)
    throw new RoomError('NOT_HOST');
  if (state.row.status === 'playing') throw new RoomError('HAND_IN_PROGRESS');
  if (c.payload.expectedRoomVersion !== state.row.roomVersion) throw new RoomError('STALE_STATE');
  let row = state.row,
    participants = state.participants,
    ledger: LedgerEffect[] = [],
    changed = true,
    clear = false;
  if (c.event === 'room:ready') {
    changed = member.ready !== c.payload.ready;
    const ready = c.payload.ready;
    participants = participants.map((p) =>
      p.participantId === member.participantId ? { ...p, ready } : p,
    );
  } else if (c.event === 'room:capacity:set') {
    if (c.payload.capacity < participants.filter((p) => p.leftAt === null).length)
      throw new RoomError('INVALID_INPUT');
    changed = row.capacity !== c.payload.capacity;
    row = { ...row, capacity: c.payload.capacity };
    clear = changed;
  } else if (c.event === 'room:bot:add') {
    if (participants.filter((p) => p.leftAt === null).length >= row.capacity)
      throw new RoomError('ROOM_FULL');
    const seatId = c.payload.seatId;
    if (participants.some((p) => p.leftAt === null && p.seatId === seatId))
      throw new RoomError('INVALID_INPUT');
    const p: ParticipantRow = {
      participantId: randomUUID(),
      roomId: row.roomId,
      sessionId: null,
      botId: randomUUID(),
      seatId,
      nickname: '电脑' + (seatId + 1),
      stack: 2000,
      admission: 'active',
      joinedAt: now,
      leftAt: null,
      ready: false,
      botDifficulty: c.payload.difficulty,
    };
    participants = [...participants, p];
    ledger = [
      {
        participantId: p.participantId,
        matchId: state.match.matchId,
        type: 'seat_grant',
        delta: 2000,
      },
    ];
    clear = true;
  } else if (c.event === 'room:bot:remove') {
    const seatId = c.payload.seatId,
      p = participants.find((p) => p.leftAt === null && p.seatId === seatId);
    if (!p || p.botId === null) throw new RoomError('INVALID_INPUT');
    participants = participants.map((v) =>
      v.participantId === p.participantId ? { ...v, stack: 0, leftAt: now, ready: false } : v,
    );
    if (p.stack)
      ledger = [
        {
          participantId: p.participantId,
          matchId: state.match.matchId,
          type: 'seat_cashout',
          delta: -p.stack,
        },
      ];
    clear = true;
  } else if (c.event === 'room:reset:propose') {
    changed = row.resetProposal === null;
    if (changed) {
      row = {
        ...row,
        resetProposal: { proposedByParticipantId: member.participantId, proposedAt: now },
      };
      clear = true;
    }
  } else if (c.event === 'room:reset:cancel') {
    changed = row.resetProposal !== null;
    row = { ...row, resetProposal: null };
    clear = changed;
  } else throw new RoomError('INVALID_INPUT');
  if (clear) participants = participants.map((p) => ({ ...p, ready: false }));
  return {
    state: changed
      ? { ...state, row: { ...row, roomVersion: nextVersion(row.roomVersion) }, participants }
      : state,
    ledger,
    changed,
  };
}
