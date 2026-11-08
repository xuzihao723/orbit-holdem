import type {
  RoomView,
  PlayerView,
  HandResultView,
  CommandAck,
  GuestResponse,
  ResumeResponse,
  SessionStatus,
  HistoryResponse,
  ReplayResponse,
} from '@orbit/protocol';
type Check = (value: unknown) => boolean;
const str: Check = (v) => typeof v === 'string' && v.length > 0 && v.length <= 512;
const int: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const bool: Check = (v) => typeof v === 'boolean';
const literal =
  (...values: unknown[]): Check =>
  (v) =>
    values.includes(v);
const nil =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const list =
  (check: Check, min = 0, max = 100): Check =>
  (v) =>
    Array.isArray(v) &&
    v.length >= min &&
    v.length <= max &&
    Object.keys(v).length === v.length &&
    v.every(check);
const exact =
  (shape: Record<string, Check>): Check =>
  (v) => {
    if (
      !v ||
      typeof v !== 'object' ||
      Array.isArray(v) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    )
      return false;
    const keys = Reflect.ownKeys(v);
    return (
      keys.length === Object.keys(shape).length &&
      keys.every(
        (k) =>
          typeof k === 'string' &&
          Object.hasOwn(shape, k) &&
          'value' in Object.getOwnPropertyDescriptor(v, k)!,
      ) &&
      Object.entries(shape).every(([k, check]) => check((v as Record<string, unknown>)[k]))
    );
  };
const card: Check = (v) => typeof v === 'string' && /^(?:[2-9]|10|J|Q|K|A)[SHCD]$/.test(v);
const cards =
  (min: number, max: number): Check =>
  (v) =>
    list(card, min, max)(v) && new Set(v as unknown[]).size === (v as unknown[]).length;
const seat = literal(0, 1, 2, 3),
  admission = literal('waitingNextHand', 'active', 'eliminated', 'leaving');
const meta = { protocolVersion: literal(1), serverEpoch: str, serverTime: int };
const nickname: Check = (v) =>
  typeof v === 'string' &&
  v === v.trim() &&
  !/\p{Cc}/u.test(v) &&
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(v)].length >= 1 &&
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(v)].length <= 12;
const occupant = { participantId: str, nickname, stack: int, admission };
const human = exact({
  ...occupant,
  kind: literal('human'),
  difficulty: literal(null),
  online: bool,
  ready: bool,
  isHost: bool,
});
const bot = exact({
  ...occupant,
  kind: literal('bot'),
  difficulty: literal('basic', 'standard'),
  online: literal(true),
  ready: literal(null),
  isHost: literal(false),
});
const roomShape = {
  ...meta,
  roomId: str,
  roomCode: str,
  roomVersion: int,
  matchId: nil(str),
  currentHandId: nil(str),
  capacity: literal(2, 3, 4),
  status: literal('waiting', 'playing', 'betweenHands', 'matchFinished', 'pausedFault', 'closed'),
  hostParticipantId: nil(str),
  seats: list(
    (v) =>
      exact({
        seatId: seat,
        availability: literal('open', 'capacityClosed'),
        occupant: literal(null),
      })(v) ||
      exact({
        seatId: seat,
        availability: literal('occupied'),
        occupant: (v) => human(v) || bot(v),
      })(v),
    4,
    4,
  ),
  canStart: bool,
  startBlockReasons: list(
    literal(
      'ROOM_NOT_WAITING',
      'NOT_ENOUGH_PLAYERS',
      'PARTICIPANT_NOT_READY',
      'PARTICIPANT_OFFLINE',
      'HOST_OFFLINE',
      'RESET_CONSENT_MISSING',
      'PENDING_BOUNDARY_CHANGE',
      'ROOM_PAUSED',
    ),
  ),
  resetProposal: nil(exact({ proposedByParticipantId: str, proposedAt: int })),
};
const reveal = exact({ participantId: str, cards: cards(2, 2) });
const potShape = { potId: str, amount: int, eligibleParticipantIds: list(str, 1, 4) };
const finalStack = exact({ participantId: str, seatId: seat, stack: int });
const handShape = {
  roomId: str,
  matchId: str,
  handId: str,
  handVersion: int,
  phase: literal('preflop', 'flop', 'turn', 'river', 'showdown', 'settled'),
  dealerSeatId: seat,
  smallBlindSeatId: seat,
  bigBlindSeatId: seat,
  players: list(
    exact({
      participantId: str,
      seatId: seat,
      stack: int,
      streetCommitted: int,
      handCommitted: int,
      folded: bool,
      allIn: bool,
      hiddenCardCount: literal(0, 2),
    }),
    2,
    4,
  ),
  board: cards(0, 5),
  showdownCards: list(reveal, 0, 4),
  pots: list(exact(potShape), 0, 4),
  potTotal: int,
  actorSeatId: nil(seat),
  turnId: nil(str),
  deadline: nil(int),
  publicEventSequence: int,
};
const legal = exact({
  allowed: list(literal('fold', 'check', 'call', 'bet', 'raise', 'allIn'), 0, 6),
  callAmount: int,
  minRaiseTo: nil(int),
  maxRaiseTo: nil(int),
  allIn: nil(exact({ raiseTo: int, additionalAmount: int, kind: literal('call', 'bet', 'raise') })),
});
const playerShape = {
  ...meta,
  ...handShape,
  roomVersion: int,
  self: exact({ participantId: str, admission, holeCards: nil(cards(2, 2)), legalActions: legal }),
};
const resultShape = {
  ...meta,
  roomVersion: int,
  roomId: str,
  matchId: str,
  handId: str,
  handVersion: int,
  phase: literal('settled'),
  board: cards(0, 5),
  showdownCards: list(reveal, 0, 4),
  pots: list(
    exact({
      ...potShape,
      winnerParticipantIds: list(str, 1, 4),
      allocations: list(exact({ participantId: str, amount: int }), 1, 4),
      winningCategory: nil(literal(0, 1, 2, 3, 4, 5, 6, 7, 8)),
    }),
    0,
    4,
  ),
  refunds: list(exact({ participantId: str, amount: int }), 0, 4),
  finalStacks: list(finalStack, 2, 4),
  reason: literal('showdown', 'allOthersFolded'),
};
const errorCode = literal(
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_FORBIDDEN',
  'INVALID_INPUT',
  'NOT_HOST',
  'NOT_READY',
  'NOT_ENOUGH_PLAYERS',
  'HAND_IN_PROGRESS',
  'NOT_YOUR_TURN',
  'ILLEGAL_ACTION',
  'ILLEGAL_AMOUNT',
  'STALE_STATE',
  'HAND_MISMATCH',
  'TURN_EXPIRED',
  'SESSION_EXPIRED',
  'SESSION_TAKEN_OVER',
  'COMMAND_ID_CONFLICT',
  'RATE_LIMITED',
  'ROOM_PAUSED',
  'PERSISTENCE_UNAVAILABLE',
  'REPLAY_FORBIDDEN',
  'REPLAY_NOT_FOUND',
  'SERVER_RESTARTED',
);
const failure = {
  ...meta,
  ok: literal(false),
  code: errorCode,
  retryable: bool,
  retryAfterMs: nil(int),
  fieldIssues: list(
    exact({
      field: str,
      reason: literal('required', 'invalidType', 'outOfRange', 'invalidFormat', 'unknownField'),
    }),
  ),
  roomId: nil(str),
  handId: nil(str),
  latestRoomVersion: nil(int),
  latestHandVersion: nil(int),
};
const ack: Check = (v) =>
  exact({
    ...meta,
    commandId: str,
    ok: literal(true),
    duplicate: bool,
    roomId: str,
    appliedRoomVersion: int,
    handId: nil(str),
    appliedHandVersion: nil(int),
  })(v) || exact({ ...failure, commandId: nil(str), duplicate: bool })(v);
const identityBase = {
  ...meta,
  requestId: str,
  ok: literal(true),
  sessionId: str,
  expiresAt: int,
  connectionGeneration: int,
};
const requestFailure = exact({ ...failure, requestId: nil(str) });
const guest: Check = (v) => exact({ ...identityBase, resumeToken: str })(v) || requestFailure(v);
const resume: Check = (v) =>
  requestFailure(v) ||
  exact({
    ...identityBase,
    outcome: literal('identityOnly'),
    reason: literal('notSeated', 'seatExpired', 'roomClosed'),
    roomView: literal(null),
    playerView: literal(null),
  })(v) ||
  exact({
    ...identityBase,
    outcome: literal('handInterrupted'),
    interruptedHandId: str,
    roomView: literal(null),
    playerView: literal(null),
  })(v) ||
  exact({
    ...identityBase,
    outcome: literal('seatRestored'),
    participantId: str,
    roomView: exact(roomShape),
    playerView: nil(exact(playerShape)),
  })(v);
export function freezeValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeValue(child);
  }
  return value;
}
function parse<T>(value: unknown, check: Check): T | null {
  try {
    return check(value) ? (freezeValue(structuredClone(value)) as T) : null;
  } catch {
    return null;
  }
}
export const readRoom = (v: unknown) => parse<RoomView>(v, exact(roomShape));
export const readPlayer = (v: unknown) => parse<PlayerView>(v, exact(playerShape));
export const readResult = (v: unknown) => parse<HandResultView>(v, exact(resultShape));
export const readAck = (v: unknown) => parse<CommandAck>(v, ack);
export const readGuest = (v: unknown) => parse<GuestResponse>(v, guest);
export const readResume = (v: unknown) => parse<ResumeResponse>(v, resume);
export const readStatus = (v: unknown) =>
  parse<SessionStatus>(
    v,
    exact({
      ...meta,
      status: literal('authenticated', 'reconnecting', 'takenOver', 'expired', 'serverRestarted'),
      connectionGeneration: nil(int),
    }),
  );
const historyBase = {
  roomId: str,
  matchId: str,
  handId: str,
  participantId: str,
  playerCount: literal(2, 3, 4),
  startedAt: int,
  endedAt: int,
  startingStack: int,
};
const signedInt: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v);
export const readHistory = (v: unknown) =>
  parse<HistoryResponse>(
    v,
    (value) =>
      requestFailure(value) ||
      exact({
        ...meta,
        requestId: str,
        ok: literal(true),
        nextCursor: nil(str),
        items: list(
          (item) =>
            exact({
              ...historyBase,
              status: literal('settled'),
              endingStack: int,
              netHandChange: signedInt,
              wonAnyPot: bool,
            })(item) ||
            exact({
              ...historyBase,
              status: literal('interrupted'),
              endingStack: literal(null),
              netHandChange: literal(null),
              wonAnyPot: literal(null),
            })(item),
          0,
          50,
        ),
      })(value),
  );
const { turnId: _turn, deadline: _deadline, ...replayHandShape } = handShape;
const {
  protocolVersion: _protocol,
  serverEpoch: _epoch,
  serverTime: _time,
  roomVersion: _room,
  ...replayResultShape
} = resultShape;
const replayPhase = literal(
  'preflop',
  'flop',
  'turn',
  'river',
  'showdown',
  'settled',
  'interrupted',
);
export function readReplay(v: unknown): ReplayResponse | null {
  const parsed = parse<ReplayResponse>(
    v,
    (value) =>
      requestFailure(value) ||
      exact({
        ...meta,
        requestId: str,
        ok: literal(true),
        handId: str,
        viewerParticipantId: str,
        frames: list(
          exact({
            sequence: int,
            at: int,
            actionText: str,
            state: exact({ ...replayHandShape, phase: replayPhase }),
            ownerHoleCards: nil(cards(2, 2)),
          }),
          1,
          10002,
        ),
        stageStarts: list(exact({ phase: replayPhase, sequence: int }), 1, 7),
        result: nil(exact(replayResultShape)),
      })(value),
  );
  if (!parsed || !parsed.ok) return parsed;
  const total = parsed.frames[0]!.state.players.reduce((n, p) => n + p.stack + p.handCommitted, 0);
  if (
    parsed.frames[0]!.sequence !== 0 ||
    parsed.frames[0]!.ownerHoleCards !== null ||
    parsed.frames.some(
      (f, i) =>
        f.state.handId !== parsed.handId ||
        (i > 0 && f.sequence <= parsed.frames[i - 1]!.sequence) ||
        !f.state.players.some((p) => p.participantId === parsed.viewerParticipantId) ||
        f.state.players.reduce((n, p) => n + p.stack + p.handCommitted, 0) !== total ||
        f.state.potTotal !== f.state.players.reduce((n, p) => n + p.handCommitted, 0),
    ) ||
    parsed.stageStarts.some(
      (s) => !parsed.frames.some((f) => f.sequence === s.sequence && f.state.phase === s.phase),
    ) ||
    (parsed.result && parsed.result.handId !== parsed.handId)
  )
    return null;
  return parsed;
}
