import type { SessionRuntime } from '../sessions/session-types.js';
import type { RoomState } from './room-types.js';
import { nextVersion } from './room-types.js';
import { isSessionOnline } from './room-view.js';
import type { LedgerEffect } from './room-lifecycle.js';
export function chooseHost(state: RoomState, sessions: SessionRuntime) {
  const reserved = state.participants.find(
    (p) =>
      p.participantId === state.row.hostParticipantId &&
      p.leftAt === null &&
      p.admission !== 'leaving' &&
      p.sessionId !== null &&
      sessions.canAccessSeat(state.row.roomId, p.participantId),
  );
  if (reserved) return reserved.participantId;
  const current = state.participants.filter(
    (p) =>
      p.leftAt === null &&
      p.admission !== 'leaving' &&
      p.sessionId !== null &&
      sessions.canAccessSeat(state.row.roomId, p.participantId) &&
      isSessionOnline(sessions, p.sessionId),
  );
  return (
    current.find((p) => p.participantId === state.row.hostParticipantId)?.participantId ??
    current.sort(
      (a, b) => a.joinedAt - b.joinedAt || a.participantId.localeCompare(b.participantId),
    )[0]?.participantId ??
    null
  );
}
export function prepareBoundary(state: RoomState, sessions: SessionRuntime, now: number) {
  if (state.hand?.phase !== 'settled') throw Error('BOUNDARY_REQUIRES_SETTLED_HAND');
  const ledger: LedgerEffect[] = [];
  const participants = state.participants.map((p) => {
    if (p.leftAt !== null) return p;
    const leaving =
      p.admission === 'leaving' || !sessions.canAccessSeat(state.row.roomId, p.participantId);
    if (leaving) {
      if (p.stack)
        ledger.push({
          participantId: p.participantId,
          matchId: state.match.matchId,
          type: 'seat_cashout',
          delta: -p.stack,
        });
      return { ...p, admission: 'leaving' as const, stack: 0, leftAt: now, ready: false };
    }
    if (p.admission === 'waitingNextHand') {
      ledger.push({
        participantId: p.participantId,
        matchId: state.match.matchId,
        type: 'seat_grant',
        delta: 2000,
      });
      return { ...p, admission: 'active' as const, stack: 2000, ready: false };
    }
    return { ...p, ready: false };
  });
  const human = participants.some((p) => p.leftAt === null && p.sessionId !== null),
    playing =
      participants.filter((p) => p.leftAt === null && p.admission === 'active' && p.stack > 0)
        .length >= 2;
  const next: RoomState = {
    ...state,
    boundaryPending: false,
    participants,
    turnClock: null,
    row: {
      ...state.row,
      status: !human ? 'closed' : playing ? 'betweenHands' : 'matchFinished',
      roomVersion: nextVersion(state.row.roomVersion),
      resetProposal: null,
      closedAt: human ? null : now,
    },
    match: playing
      ? { ...state.match, status: 'active', endedAt: null }
      : { ...state.match, status: 'finished', endedAt: state.match.endedAt ?? now },
    previous: state.previous
      ? {
          ...state.previous,
          continuedSeatIds: state.hand.players
            .filter((h) =>
              participants.some(
                (p) =>
                  p.participantId === h.participantId &&
                  p.leftAt === null &&
                  p.admission === 'active' &&
                  p.stack > 0,
              ),
            )
            .map((h) => h.seatId),
        }
      : null,
  };
  return {
    state: { ...next, row: { ...next.row, hostParticipantId: chooseHost(next, sessions) } },
    ledger,
  };
}
