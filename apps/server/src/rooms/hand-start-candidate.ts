import { withTurnClock } from '../game/turn-timer.js';
import { randomUUID } from 'node:crypto';
import {
  createDeck,
  shuffleDeck,
  chooseFirstDealer,
  resolveNextPositions,
  createHand,
  assertHandInvariants,
  type RandomInt,
  type CardId,
} from '@orbit/poker-core';
import { secureRandomInt } from '../game/random.js';
import { projectHandResult } from '../game/hand-result.js';
import { mapHandEvents } from '../game/event-mapper.js';
import { RoomError, nextVersion, type RoomState } from './room-types.js';
import type { LedgerEffect } from './room-lifecycle.js';
import type { HandRow } from '../persistence/hand-rows.js';
export interface StartOptions {
  handDeck?: () => readonly CardId[];
  randomInt?: RandomInt;
}
export function prepareHandStartCandidate(
  state: RoomState,
  context: { now: number; serverEpoch: string; reset?: boolean },
  options: StartOptions = {},
) {
  const reset = context.reset ?? state.row.resetProposal !== null;
  if (
    state.row.status === 'playing' ||
    state.row.status === 'pausedFault' ||
    state.row.status === 'closed'
  )
    throw Error('SIMULATION_START_REQUIRES_BOUNDARY');
  if (
    !reset &&
    state.participants.filter((p) => p.leftAt === null && p.admission === 'active' && p.stack > 0)
      .length < 2
  )
    throw Error('NOT_ENOUGH_PLAYERS');
  const now = context.now,
    ledger: LedgerEffect[] = [],
    oldMatch = state.match;
  let match = oldMatch,
    participants = state.participants;
  if (reset) {
    match = {
      matchId: randomUUID(),
      roomId: state.row.roomId,
      status: 'active',
      lastBigBlindSeatId: null,
      startedAt: now,
      endedAt: null,
    };
    participants = participants.map((p) => {
      if (p.leftAt !== null) return p;
      if (p.stack)
        ledger.push({
          participantId: p.participantId,
          matchId: oldMatch.matchId,
          type: 'match_reset_remove',
          delta: -p.stack,
        });
      ledger.push({
        participantId: p.participantId,
        matchId: match.matchId,
        type: 'match_reset_grant',
        delta: 2000,
      });
      return { ...p, stack: 2000, admission: 'active' as const, ready: false };
    });
  }
  const active = participants
      .filter((p) => p.leftAt === null && p.admission === 'active' && p.stack > 0)
      .sort((a, b) => a.seatId - b.seatId),
    seats = active.map((p) => p.seatId),
    rng = options.randomInt ?? secureRandomInt;
  const previous =
    !reset && state.hand
      ? {
          seatIds: state.hand.players.map((p) => p.seatId),
          dealerSeatId: state.hand.positions.dealerSeatId,
          bigBlindSeatId: state.hand.positions.bigBlindSeatId,
          continuedSeatIds: state.hand.players
            .filter((p) => active.some((a) => a.participantId === p.participantId))
            .map((p) => p.seatId),
        }
      : null;
  const dealer = previous
    ? resolveNextPositions(previous, seats).dealerSeatId
    : chooseFirstDealer(seats, rng);
  const made = createHand({
      handId: randomUUID(),
      dealerSeatId: dealer,
      deck: options.handDeck ? options.handDeck() : shuffleDeck(createDeck(), secureRandomInt),
      players: active.map((p) => ({
        seatId: p.seatId,
        participantId: p.participantId,
        stack: p.stack,
      })),
    }),
    hand = made.state;
  assertHandInvariants(hand);
  participants = participants.map((p) => {
    const h = hand.players.find((h) => h.participantId === p.participantId);
    return {
      ...p,
      ready: false,
      ...(h
        ? {
            stack: h.stack,
            admission:
              h.stack === 0 && hand.phase === 'settled'
                ? ('eliminated' as const)
                : ('active' as const),
          }
        : {}),
    };
  });
  const settled = hand.phase === 'settled',
    finished =
      settled &&
      participants.filter((p) => p.leftAt === null && p.admission === 'active' && p.stack > 0)
        .length < 2;
  match = {
    ...match,
    lastBigBlindSeatId: hand.positions.bigBlindSeatId,
    ...(finished ? { status: 'finished' as const, endedAt: now } : {}),
  };
  const row = {
    ...state.row,
    matchId: match.matchId,
    currentHandId: hand.handId,
    roomVersion: nextVersion(state.row.roomVersion),
    status: finished
      ? ('matchFinished' as const)
      : settled
        ? ('betweenHands' as const)
        : ('playing' as const),
    resetProposal: null,
  };
  const next: RoomState = {
    publicActions: [],
    row,
    participants,
    match,
    hand,
    previous,
    publicEventSequence: Math.max(
      0,
      ...made.events.filter((e) => e.visibility === 'public').map((e) => e.sequence),
    ),
  };
  const stored: HandRow = {
    handId: hand.handId,
    roomId: row.roomId,
    matchId: match.matchId,
    startEpoch: context.serverEpoch,
    handVersion: hand.handVersion,
    status: settled ? 'settled' : 'active',
    participantIds: hand.players.map((p) => p.participantId),
    startingStacks: hand.players.map((p) => ({
      participantId: p.participantId,
      stack: p.startingStack,
    })),
    positions: hand.positions,
    initialChipTotal: hand.initialChipTotal,
    result: settled ? projectHandResult(hand, row.roomId, match.matchId) : null,
    startedAt: now,
    endedAt: settled ? now : null,
  };
  return {
    state: withTurnClock(next, now),
    ledger,
    hand: stored,
    events: mapHandEvents(hand, made.events, now),
    matchWrites: reset
      ? [{ ...oldMatch, status: 'finished' as const, endedAt: oldMatch.endedAt ?? now }, match]
      : [match],
  };
}
