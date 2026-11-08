import { prepareHandStartCandidate } from './hand-start-candidate.js';
export type { StartOptions } from './hand-start-candidate.js';
import type { AuthenticatedCommand } from '../transport/types.js';
import type { SessionRuntime } from '../sessions/session-types.js';
import { startConditions } from './start-conditions.js';
import { RoomError, type RoomState } from './room-types.js';
export function prepareHandStart(
  c: Extract<AuthenticatedCommand, { event: 'room:start' }>,
  state: RoomState,
  sessions: SessionRuntime,
  options: import('./hand-start-candidate.js').StartOptions = {},
) {
  const member = state.participants.find(
    (p) => p.leftAt === null && p.sessionId === c.control.sessionId,
  );
  if (!member || member.participantId !== state.row.hostParticipantId)
    throw new RoomError('NOT_HOST');
  if (state.row.status === 'playing') throw new RoomError('HAND_IN_PROGRESS');
  if (c.payload.expectedRoomVersion !== state.row.roomVersion) throw new RoomError('STALE_STATE');
  const conditions = startConditions(state, sessions);
  if (!conditions.canStart) {
    const reason = conditions.startBlockReasons[0];
    throw new RoomError(
      reason === 'ROOM_PAUSED'
        ? 'ROOM_PAUSED'
        : reason === 'NOT_ENOUGH_PLAYERS'
          ? 'NOT_ENOUGH_PLAYERS'
          : 'NOT_READY',
    );
  }
  return prepareHandStartCandidate(
    state,
    { now: sessions.meta().serverTime, serverEpoch: sessions.serverEpoch },
    options,
  );
}
