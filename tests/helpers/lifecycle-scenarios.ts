import { scenario, array, record, integer, text, bool } from './fixture-read.js';
import { cards, seat } from './fixture-read.js';
import {
  createDeck,
  type BettingPlayer,
  type BettingRound,
} from '../../packages/poker-core/src/index.js';
export function lifecycleScenario(
  id: 'LIFE01' | 'LIFE02' | 'LIFE03' | 'LIFE04' | 'LIFE08' | 'LIFE09' | 'LIFE12',
) {
  const operation = {
    LIFE01: 'joinThenFinishHandAndAdmit',
    LIFE02: 'requestLeaveThenAdvance',
    LIFE03: 'requestLeave',
    LIFE04: 'requestLeaveSettleThenRemove',
    LIFE08: 'evaluateHostAtTimes',
    LIFE09: 'evaluateAllOfflineLifecycle',
    LIFE12: 'applyFailureAndRestartVariants',
  }[id];
  return scenario(id, [operation]);
}
export function partialLeaveScenario(id: 'LIFE02' | 'LIFE03') {
  const s = lifecycleScenario(id),
    players: BettingPlayer[] = array(s.given.players).map((v) => {
      const p = record(v);
      return {
        seatId: seat(p.seatId),
        stack: integer(p.stack),
        streetCommitted: integer(p.streetCommitted),
        handCommitted: integer(p.handCommitted),
        folded: bool(p.folded),
        allIn: bool(p.allIn),
        lastActedAtBet: p.lastActedAtBet === null ? null : integer(p.lastActedAtBet),
      };
    });
  const round: BettingRound = {
    street: id === 'LIFE02' ? 'flop' : 'preflop',
    bigBlind: 20,
    currentBet: id === 'LIFE02' ? 0 : integer(s.given.currentBet),
    lastFullRaiseSize: 20,
    players,
    actionOrder: players.map((p) => p.seatId),
    pendingSeatIds: players.map((p) => p.seatId),
    actorSeatId: seat(s.given.actorSeatId),
  };
  return { round, leaveSeatId: seat(s.given.leaveSeatId), expected: s.expected };
}
export function allInLeaveScenario() {
  const s = lifecycleScenario('LIFE04'),
    holes = record(s.given.settlementHoleCards),
    own = ['A', 'B', 'C'].map((id) => cards(holes[id])),
    board = cards(s.given.settlementBoard),
    prefix = [
      own[0]![0]!,
      own[1]![0]!,
      own[2]![0]!,
      own[0]![1]!,
      own[1]![1]!,
      own[2]![1]!,
      '2S' as const,
      ...board.slice(0, 3),
      '3S' as const,
      board[3]!,
      '4S' as const,
      board[4]!,
    ];
  return {
    ...s,
    stacks: ['A', 'B', 'C'].map((id) => integer(record(s.given.contributions)[id])),
    deck: [...prefix, ...createDeck().filter((c) => !prefix.includes(c))],
  };
}
export function recoveryScenario() {
  const r = scenario('LIFE06', ['resumeIndependentVariants']);
  return {
    deadline: integer(r.given.deadline),
    disconnectedAt: integer(r.given.disconnectedAt),
    variants: array(r.expected.variants).map((v) => {
      const x = record(v);
      return {
        at: integer(x.at),
        remainingMs: integer(x.remainingMs),
        mayControl: bool(x.mayControlUnexpiredTurn),
      };
    }),
  };
}
export function reservationScenario() {
  const r = scenario('LIFE07', ['resumeReservationVariants']);
  return {
    reservationMs: integer(r.given.reservationMs),
    variants: array(r.expected.variants).map((v) => {
      const x = record(v);
      return { at: integer(x.at), seatRestored: bool(x.seatRestored) };
    }),
  };
}
export function timeoutScenario() {
  const x = scenario('LIFE05', ['resolveTimeoutPolicyAndRaces']);
  return {
    deadline: integer(x.given.deadline),
    variants: array(x.given.variants).map((v) => {
      const r = record(v);
      return {
        name: text(r.name),
        currentBet: integer(r.currentBet),
        actorCommitted: integer(r.actorCommitted),
        actorStack: integer(r.actorStack),
      };
    }),
    races: array(x.given.raceCases).map((v) => {
      const r = record(v);
      return {
        name: text(r.name),
        receivedAt: integer(r.userReceivedAt),
        timerQueuedAt: integer(r.timerQueuedAt),
      };
    }),
    expected: record(x.expected),
  };
}
