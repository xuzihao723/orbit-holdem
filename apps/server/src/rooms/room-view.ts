import { startConditions } from './start-conditions.js';
import { isSessionOnline } from './presence.js';
export { isSessionOnline } from './presence.js';
import type { RoomView, PublicSeatView, SeatId, ServerMeta } from '@orbit/protocol';
import type { RoomState } from './room-types.js';
import type { SessionRuntime } from '../sessions/session-types.js';
export function projectRoomView(
  state: RoomState,
  sessions: SessionRuntime,
  meta: ServerMeta,
): RoomView {
  const online = (sessionId: string) => isSessionOnline(sessions, sessionId);
  const current = state.participants.filter((p) => p.leftAt === null),
    open = Math.max(0, state.row.capacity - current.length);
  let used = 0;
  const seats: PublicSeatView[] = [0, 1, 2, 3].map((id) => {
    const seatId = id as SeatId,
      p = current.find((p) => p.seatId === id);
    if (!p)
      return { seatId, availability: used++ < open ? 'open' : 'capacityClosed', occupant: null };
    const common = {
      participantId: p.participantId,
      nickname: p.nickname,
      stack: p.stack,
      admission: p.admission,
    };
    return {
      seatId,
      availability: 'occupied',
      occupant:
        p.sessionId !== null
          ? {
              ...common,
              kind: 'human',
              difficulty: null,
              online:
                online(p.sessionId) && sessions.canAccessSeat(state.row.roomId, p.participantId),
              ready: p.ready,
              isHost: p.participantId === state.row.hostParticipantId,
            }
          : {
              ...common,
              kind: 'bot',
              difficulty: p.botDifficulty!,
              online: true,
              ready: null,
              isHost: false,
            },
    };
  });
  const conditions = startConditions(state, sessions);
  return {
    ...meta,
    roomId: state.row.roomId,
    roomCode: state.row.roomCode,
    roomVersion: state.row.roomVersion,
    matchId: state.row.matchId,
    currentHandId: state.row.currentHandId,
    capacity: state.row.capacity,
    status: state.row.status,
    hostParticipantId: state.row.hostParticipantId,
    seats,
    canStart: conditions.canStart,
    startBlockReasons: conditions.startBlockReasons,
    resetProposal: state.row.resetProposal
      ? {
          proposedByParticipantId: state.row.resetProposal.proposedByParticipantId,
          proposedAt: state.row.resetProposal.proposedAt,
        }
      : null,
  };
}
