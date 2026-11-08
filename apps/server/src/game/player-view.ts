import type { PlayerView, LegalActionsView, CardPair } from '@orbit/protocol';
import { getHandLegalActions } from '@orbit/poker-core';
import type { RoomState } from '../rooms/room-types.js';
import type { SessionRuntime, ControlContext } from '../sessions/session-types.js';
import { projectPublicHand } from './public-hand-view.js';
export function projectPlayerView(
  state: RoomState,
  sessions: SessionRuntime,
  control: ControlContext,
): PlayerView | null {
  if (
    !sessions.service.checkController(control).ok ||
    state.row.status === 'closed' ||
    state.row.status === 'pausedFault'
  )
    return null;
  const member = state.participants.find(
      (p) => p.sessionId === control.sessionId && p.leftAt === null,
    ),
    pub = projectPublicHand(state);
  if (!member || !pub || !sessions.canAccessSeat(state.row.roomId, member.participantId))
    return null;
  const own = state.hand!.players.find(
    (p) => p.participantId === member.participantId && p.seatId === member.seatId,
  );
  let legal: LegalActionsView = {
    allowed: [],
    callAmount: 0,
    minRaiseTo: null,
    maxRaiseTo: null,
    allIn: null,
  };
  if (
    own &&
    member.admission === 'active' &&
    !own.folded &&
    !own.allIn &&
    pub.actorSeatId === own.seatId &&
    state.row.status === 'playing'
  ) {
    const core = getHandLegalActions(state.hand!, own.seatId);
    legal = {
      allowed: [...core.allowed],
      callAmount: core.callAmount,
      minRaiseTo: core.minRaiseTo,
      maxRaiseTo: core.maxRaiseTo,
      allIn: core.allIn
        ? {
            raiseTo: core.allIn.raiseTo,
            additionalAmount: core.allIn.additionalAmount,
            kind: core.allIn.kind,
          }
        : null,
    };
  }
  return {
    ...sessions.meta(),
    ...pub,
    roomVersion: state.row.roomVersion,
    self: {
      participantId: member.participantId,
      admission: member.admission,
      holeCards: own ? ([...own.holeCards] as CardPair) : null,
      legalActions: legal,
    },
  };
}
