import type { SessionRuntime, ResumeContextResolver } from './session-types.js';
import type { RoomService } from '../rooms/room-service.js';
import type { ReservationBook } from './reservation-book.js';
import type { PersistenceRepositories } from '../persistence/rows.js';
import { defaultResumeContext } from './resume-context.js';
import { projectRoomView } from '../rooms/room-view.js';
import { projectPlayerView } from '../game/player-view.js';
import { PersistenceError } from '../persistence/errors.js';
export function liveResumeContext(
  rooms: RoomService,
  sessions: SessionRuntime,
  book: ReservationBook,
  repository: PersistenceRepositories,
): ResumeContextResolver {
  const fallback = defaultResumeContext(repository);
  return {
    async resolve(input) {
      const candidates = rooms.store
        .all()
        .filter(
          (r) =>
            r.row.status !== 'closed' &&
            r.row.serverEpoch === sessions.serverEpoch &&
            r.participants.some((p) => p.sessionId === input.sessionId && p.leftAt === null),
        );
      const id = input.roomId ?? (candidates.length === 1 ? candidates[0]!.row.roomId : null);
      if (!id) return fallback.resolve(input);
      return rooms.queue.run(id, () => {
        const control = input.control;
        if (!control || !sessions.service.checkController(control).ok)
          throw new PersistenceError('PERSISTENCE_CONFLICT');
        const state = rooms.store.get(id);
        if (!state || state.row.serverEpoch !== sessions.serverEpoch)
          return fallback.resolve(input);
        if (state.row.status === 'closed')
          return {
            outcome: 'identityOnly' as const,
            reason: 'roomClosed' as const,
            roomView: null,
            playerView: null,
          };
        const member = state.participants.find(
          (p) => p.sessionId === input.sessionId && p.leftAt === null,
        );
        if (!member) return fallback.resolve(input);
        if (member.admission === 'leaving' || !book.allowed(id, member.participantId))
          return {
            outcome: 'identityOnly' as const,
            reason: 'seatExpired' as const,
            roomView: null,
            playerView: null,
          };
        return {
          outcome: 'seatRestored' as const,
          participantId: member.participantId,
          roomView: projectRoomView(state, sessions, sessions.meta()),
          playerView: projectPlayerView(state, sessions, control),
        };
      });
    },
    finalize(_input, resolution) {
      if (resolution.outcome !== 'seatRestored') return resolution;
      const id = resolution.roomView.roomId,
        p = resolution.participantId,
        state = rooms.store.get(id);
      if (state?.row.status === 'closed')
        return { outcome: 'identityOnly', reason: 'roomClosed', roomView: null, playerView: null };
      if (
        !state ||
        !state.participants.some(
          (member) =>
            member.participantId === p && member.leftAt === null && member.admission !== 'leaving',
        ) ||
        !book.allowed(id, p)
      )
        return { outcome: 'identityOnly', reason: 'seatExpired', roomView: null, playerView: null };
      book.restore(id, p);
      return resolution;
    },
  };
}
