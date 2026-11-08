import type { StartBlockReason } from '@orbit/protocol';
import type { RoomState } from './room-types.js';
import type { SessionRuntime } from '../sessions/session-types.js';
import { isSessionOnline } from './presence.js';
export function startConditions(state: RoomState, sessions: SessionRuntime) {
  const reasons: StartBlockReason[] = [],
    reset = state.row.resetProposal !== null,
    current = state.participants.filter((p) => p.leftAt === null),
    eligible = current.filter((p) =>
      reset ? p.admission !== 'leaving' : p.admission === 'active' && p.stack > 0,
    );
  if (state.row.status === 'pausedFault') reasons.push('ROOM_PAUSED');
  if (!(
    ['waiting', 'betweenHands'].includes(state.row.status) ||
    (reset && state.row.status === 'matchFinished')
  ))
    reasons.push('ROOM_NOT_WAITING');
  if (
    current.some((p) => p.admission === 'leaving' || (!reset && p.admission === 'waitingNextHand'))
  )
    reasons.push('PENDING_BOUNDARY_CHANGE');
  const host = current.find((p) => p.participantId === state.row.hostParticipantId);
  if (
    !host ||
    host.sessionId === null ||
    !isSessionOnline(sessions, host.sessionId) ||
    !sessions.canAccessSeat(state.row.roomId, host.participantId)
  )
    reasons.push('HOST_OFFLINE');
  if (eligible.length < 2 || eligible.length > state.row.capacity)
    reasons.push('NOT_ENOUGH_PLAYERS');
  const humans = (reset ? current : eligible).filter((p) => p.sessionId !== null);
  if (
    humans.some(
      (p) =>
        !isSessionOnline(sessions, p.sessionId!) ||
        !sessions.canAccessSeat(state.row.roomId, p.participantId),
    )
  )
    reasons.push('PARTICIPANT_OFFLINE');
  if (humans.some((p) => !p.ready))
    reasons.push(reset ? 'RESET_CONSENT_MISSING' : 'PARTICIPANT_NOT_READY');
  return { canStart: reasons.length === 0, startBlockReasons: reasons, eligible };
}
