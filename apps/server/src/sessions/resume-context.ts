import type { PersistenceRepositories } from '../persistence/rows.js';
import type { ResumeContextResolver, ResumeResolution } from './session-types.js';
export function defaultResumeContext(repository: PersistenceRepositories): ResumeContextResolver {
  return {
    resolve({ sessionId, roomId, lastSeenHandId }): ResumeResolution {
      if (lastSeenHandId) {
        const hand = repository.findOwnedHand(sessionId, lastSeenHandId);
        if (hand && hand.status === 'interrupted' && (roomId === null || hand.roomId === roomId))
          return {
            outcome: 'handInterrupted',
            interruptedHandId: hand.handId,
            roomView: null,
            playerView: null,
          };
      }
      if (roomId) {
        const owner = repository.findOwnedParticipantInRoom(sessionId, roomId);
        if (owner?.roomStatus === 'closed')
          return {
            outcome: 'identityOnly',
            reason: 'roomClosed',
            roomView: null,
            playerView: null,
          };
        if (owner?.leftAt !== null && owner !== null)
          return {
            outcome: 'identityOnly',
            reason: 'seatExpired',
            roomView: null,
            playerView: null,
          };
      }
      return { outcome: 'identityOnly', reason: 'notSeated', roomView: null, playerView: null };
    },
  };
}
