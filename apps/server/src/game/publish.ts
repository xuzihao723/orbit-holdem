import type { SessionRuntime } from '../sessions/session-types.js';
import type { RoomState, Publication } from '../rooms/room-types.js';
import { projectRoomView } from '../rooms/room-view.js';
import { projectHandResult } from './hand-result.js';
import { projectPlayerView } from './player-view.js';
import type { ControlContext } from '../sessions/session-types.js';
export function publishResultTo(
  state: RoomState,
  sessions: SessionRuntime,
  control: ControlContext,
  emit: (p: Publication) => void,
) {
  if (!state.hand?.result || !sessions.service.checkController(control).ok) return;
  const member = state.participants.find(
    (p) => p.sessionId === control.sessionId && p.leftAt === null,
  );
  if (!member || !sessions.canAccessSeat(state.row.roomId, member.participantId)) return;
  emit({
    socketId: control.socketId,
    event: 'game:result',
    payload: {
      ...sessions.meta(),
      ...projectHandResult(state.hand, state.row.roomId, state.match.matchId),
      roomVersion: state.row.roomVersion,
    },
  });
}
export function publishGameState(
  state: RoomState,
  sessions: SessionRuntime,
  emit: (p: Publication) => void,
) {
  publishPausedRoom(state, sessions, emit);
  for (const p of state.participants) {
    if (
      p.leftAt !== null ||
      p.sessionId === null ||
      !sessions.canAccessSeat(state.row.roomId, p.participantId)
    )
      continue;
    const control = sessions.registry.getCurrent(p.sessionId);
    if (!control) continue;
    const view = projectPlayerView(state, sessions, control);
    if (view) emit({ socketId: control.socketId, event: 'game:view', payload: view });
  }
  publishPublicResult(state, sessions, emit);
}
export function publishPausedRoom(
  state: RoomState,
  sessions: SessionRuntime,
  emit: (p: Publication) => void,
) {
  for (const p of state.participants) {
    if (
      p.leftAt !== null ||
      p.sessionId === null ||
      !sessions.canAccessSeat(state.row.roomId, p.participantId)
    )
      continue;
    const c = sessions.registry.getCurrent(p.sessionId);
    try {
      if (c && sessions.service.checkController(c).ok)
        emit({
          socketId: c.socketId,
          event: 'room:view',
          payload: projectRoomView(state, sessions, sessions.meta()),
        });
    } catch {
      /* Unverifiable recipients get no data. */
    }
  }
}
export function publishPublicResult(
  state: RoomState,
  sessions: SessionRuntime,
  emit: (p: Publication) => void,
) {
  if (!state.hand?.result) return;
  const result = {
    ...sessions.meta(),
    ...projectHandResult(state.hand, state.row.roomId, state.match.matchId),
    roomVersion: state.row.roomVersion,
  };
  for (const p of state.participants) {
    if (
      p.leftAt !== null ||
      p.sessionId === null ||
      !sessions.canAccessSeat(state.row.roomId, p.participantId)
    )
      continue;
    const c = sessions.registry.getCurrent(p.sessionId);
    if (c && sessions.service.checkController(c).ok)
      emit({ socketId: c.socketId, event: 'game:result', payload: result });
  }
}
