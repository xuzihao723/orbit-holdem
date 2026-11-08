import type {
  Action,
  Capacity,
  HistoryListRequest,
  HistoryPage,
  SessionResumed,
  SessionStatus,
  RoomView,
  HandPublicState,
  ClientRequestMap,
  ServerEventMap,
} from '@orbit/protocol';

const capacity: Capacity = 4;
const raise: Action = { type: 'raise', raiseTo: 100 };
// @ts-expect-error Capacity never includes a fifth seat.
const invalidCapacity: Capacity = 5;
// @ts-expect-error Fold cannot carry an amount.
const invalidFold: Action = { type: 'fold', raiseTo: 100 };

const historyRequest = { requestId: 'type-only', cursor: null } satisfies HistoryListRequest;
const metadata = { protocolVersion: 1, serverEpoch: 'type-only', serverTime: 0 } as const;
const history = {
  ...metadata,
  requestId: 'type-only',
  ok: true,
  items: [],
  nextCursor: null,
} satisfies HistoryPage;
const interrupted = {
  ...metadata,
  requestId: 'type-only',
  ok: true,
  sessionId: 'self',
  expiresAt: 1,
  connectionGeneration: 2,
  outcome: 'handInterrupted',
  interruptedHandId: 'h_interrupted',
  roomView: null,
  playerView: null,
} satisfies SessionResumed;
const takenOver = {
  ...metadata,
  status: 'takenOver',
  connectionGeneration: 2,
} satisfies SessionStatus;

const roomCommand = { commandId: 'type-only', roomId: 'r_type', expectedRoomVersion: 1 };
const remainingRequests = {
  'room:ready': { ...roomCommand, ready: true },
  'room:capacity:set': { ...roomCommand, capacity: 2 },
  'room:bot:add': { ...roomCommand, seatId: 1, difficulty: 'basic' },
  'room:bot:remove': { ...roomCommand, seatId: 1 },
  'room:leave': { commandId: 'type-only', roomId: 'r_type' },
  'room:reset:propose': roomCommand,
  'room:reset:cancel': roomCommand,
} satisfies Pick<
  ClientRequestMap,
  | 'room:ready'
  | 'room:capacity:set'
  | 'room:bot:add'
  | 'room:bot:remove'
  | 'room:leave'
  | 'room:reset:propose'
  | 'room:reset:cancel'
>;

const uncontestedResult = {
  ...metadata,
  roomVersion: 3,
  roomId: 'r_type',
  matchId: 'm_type',
  handId: 'h_type',
  handVersion: 4,
  phase: 'settled',
  board: [],
  showdownCards: [],
  pots: [
    {
      potId: 'main',
      amount: 20,
      eligibleParticipantIds: ['B'],
      winnerParticipantIds: ['B'],
      allocations: [{ participantId: 'B', amount: 20 }],
      winningCategory: null,
    },
  ],
  refunds: [{ participantId: 'B', amount: 10 }],
  finalStacks: [
    { participantId: 'A', seatId: 0, stack: 1990 },
    { participantId: 'B', seatId: 1, stack: 2010 },
  ],
  reason: 'allOthersFolded',
} satisfies ServerEventMap['game:result'];

type RequireNever<T extends never> = T;
type NoRoomSecret = RequireNever<
  Extract<'resumeToken' | 'tokenHash' | 'self' | 'deck', keyof RoomView>
>;
type NoHandSecret = RequireNever<
  Extract<'deck' | 'burnCards' | 'holeCards', keyof HandPublicState>
>;
export type PrivacyTypeGuards = [NoRoomSecret, NoHandSecret];

void [
  capacity,
  raise,
  invalidCapacity,
  invalidFold,
  historyRequest,
  history,
  interrupted,
  takenOver,
  remainingRequests,
  uncontestedResult,
];
