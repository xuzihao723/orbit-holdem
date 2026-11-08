import { withTurnClock } from './turn-timer.js';
import { applyHandAction, assertHandInvariants } from '@orbit/poker-core';
import type { AuthenticatedCommand } from '../transport/types.js';
import type { ParticipantRow } from '../persistence/domain-rows.js';
import { RoomError, nextVersion, type RoomState } from '../rooms/room-types.js';
import { mapHandFailure } from './failure-map.js';
import { mapHandEvents } from './event-mapper.js';
export function prepareAction(
  c: Pick<Extract<AuthenticatedCommand, { event: 'game:action' }>, 'payload' | 'receivedAt'>,
  state: RoomState,
  member: ParticipantRow,
  now: number,
  source: 'human' | 'timeout' | 'leave' = 'human',
) {
  const old = state.hand;
  if (
    !old ||
    old.handId !== c.payload.handId ||
    old.phase === 'settled' ||
    state.row.status !== 'playing'
  )
    throw new RoomError('HAND_MISMATCH');
  if (c.payload.turnId !== old.turnId) throw new RoomError('TURN_EXPIRED');
  if (source === 'human' && state.turnClock && c.receivedAt >= state.turnClock.deadline)
    throw new RoomError('TURN_EXPIRED');
  if (c.payload.expectedVersion !== old.handVersion) throw new RoomError('STALE_STATE');
  const player = old.players.find(
    (p) => p.participantId === member.participantId && p.seatId === member.seatId,
  );
  if (
    (member.admission !== 'active' && !(source === 'leave' && member.admission === 'leaving')) ||
    !player
  )
    throw new RoomError('ILLEGAL_ACTION');
  try {
    assertHandInvariants(old);
  } catch {
    throw new RoomError('ROOM_PAUSED');
  }
  let applied: ReturnType<typeof applyHandAction>;
  try {
    applied = applyHandAction(old, {
      seatId: player.seatId,
      turnId: c.payload.turnId,
      action: c.payload.action,
    });
  } catch {
    throw new RoomError('ROOM_PAUSED');
  }
  if (!applied.ok) throw new RoomError(mapHandFailure(applied.reason));
  const hand = applied.state;
  try {
    assertHandInvariants(hand);
  } catch {
    throw new RoomError('ROOM_PAUSED');
  }
  const settled = hand.phase === 'settled';
  const participants = state.participants.map((p) => {
    const h = hand.players.find((h) => h.participantId === p.participantId);
    return {
      ...p,
      ...(settled ? { ready: false } : {}),
      ...(h
        ? {
            stack: h.stack,
            ...(settled && p.admission !== 'leaving'
              ? { admission: h.stack === 0 ? ('eliminated' as const) : ('active' as const) }
              : {}),
          }
        : {}),
    };
  });
  const finished =
    settled &&
    participants.filter((p) => p.leftAt === null && p.admission === 'active' && p.stack > 0)
      .length < 2;
  const status = finished
    ? ('matchFinished' as const)
    : settled
      ? ('betweenHands' as const)
      : ('playing' as const);
  const changed =
    status !== state.row.status ||
    participants.some(
      (p, i) =>
        p.stack !== state.participants[i]!.stack ||
        p.admission !== state.participants[i]!.admission ||
        p.ready !== state.participants[i]!.ready,
    );
  const next: RoomState = {
    ...state,
    publicActions: [
      ...(state.publicActions ?? []),
      ...applied.events
        .filter((e) => e.kind === 'actionApplied')
        .map((e) => ({
          sequence: e.sequence,
          seatId: e.seatId,
          actionType: e.actionType,
          paidAmount: e.paidAmount,
          raiseTo: e.raiseTo,
        })),
    ].slice(-64),
    row: {
      ...state.row,
      status,
      roomVersion: changed ? nextVersion(state.row.roomVersion) : state.row.roomVersion,
    },
    match: finished ? { ...state.match, status: 'finished', endedAt: now } : state.match,
    participants,
    hand,
    publicEventSequence: Math.max(
      state.publicEventSequence,
      ...applied.events.filter((e) => e.visibility === 'public').map((e) => e.sequence),
    ),
    previous: settled
      ? {
          seatIds: hand.players.map((p) => p.seatId),
          dealerSeatId: hand.positions.dealerSeatId,
          bigBlindSeatId: hand.positions.bigBlindSeatId,
          continuedSeatIds: hand.players.filter((p) => p.stack > 0).map((p) => p.seatId),
        }
      : state.previous,
  };
  return { state: withTurnClock(next, now), events: mapHandEvents(hand, applied.events, now) };
}
