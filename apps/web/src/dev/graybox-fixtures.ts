import type { Capacity, SeatId, RoomView, PublicSeatView, LegalActionsView } from '@orbit/protocol';
import type { TablePreview, GrayboxFixture } from '../features/table/table-preview.types';
const metadata = {
  protocolVersion: 1,
  serverEpoch: 'w04-fixed-preview',
  serverTime: 1793318400000,
} as const;
const seats: SeatId[] = [0, 1, 2, 3];
const names = ['小林', '阿泽', 'W04校对昵称甲', '小满'];
function room(capacity: Capacity, occupied: readonly SeatId[], playing: boolean): RoomView {
  return {
    ...metadata,
    roomId: 'w04-preview-room',
    roomCode: 'DEMO04',
    roomVersion: 1,
    matchId: playing ? 'w04-match' : null,
    currentHandId: playing ? 'w04-hand' : null,
    capacity,
    status: playing ? 'playing' : 'waiting',
    hostParticipantId: `p${occupied[0]}`,
    seats: seats.map((seatId): PublicSeatView =>
      occupied.includes(seatId)
        ? {
            seatId,
            availability: 'occupied',
            occupant: {
              participantId: `p${seatId}`,
              nickname: names[seatId] ?? '朋友',
              kind: 'human',
              difficulty: null,
              online: true,
              ready: !playing,
              isHost: seatId === occupied[0],
              stack: playing ? 1900 : 2000,
              admission: 'active',
            },
          }
        : {
            seatId,
            availability: occupied.length < capacity ? 'open' : 'capacityClosed',
            occupant: null,
          },
    ),
    canStart: !playing && occupied.length >= 2,
    startBlockReasons: playing
      ? ['ROOM_NOT_WAITING']
      : occupied.length < 2
        ? ['NOT_ENOUGH_PLAYERS']
        : [],
    resetProposal: null,
  };
}
const noActions: LegalActionsView = {
  allowed: [],
  callAmount: 0,
  minRaiseTo: null,
  maxRaiseTo: null,
  allIn: null,
};
function table(
  capacity: Capacity,
  occupied: readonly SeatId[],
  viewerSeatId: SeatId,
): TablePreview {
  const view = room(capacity, occupied, true);
  const playerIds = occupied.map((seat) => `p${seat}`);
  const dealer = occupied[0];
  const small = occupied.length === 2 ? dealer : occupied[1];
  const big = occupied.length === 2 ? occupied[1] : occupied[2];
  if (dealer === undefined || small === undefined || big === undefined)
    throw new Error('Invalid fixture seats');
  return {
    room: view,
    viewerSeatId,
    connection: 'connected',
    remainingSeconds: 30,
    hand: {
      roomId: view.roomId,
      matchId: 'w04-match',
      handId: 'w04-hand',
      handVersion: 1,
      phase: 'flop',
      dealerSeatId: dealer,
      smallBlindSeatId: small,
      bigBlindSeatId: big,
      players: occupied.map((seatId) => ({
        participantId: `p${seatId}`,
        seatId,
        stack: 1900,
        streetCommitted: 20,
        handCommitted: 100,
        folded: false,
        allIn: false,
        hiddenCardCount: 2,
      })),
      board: ['7H', 'JC', 'QD'],
      showdownCards: [],
      pots: [{ potId: 'main', amount: 100 * occupied.length, eligibleParticipantIds: playerIds }],
      potTotal: 100 * occupied.length,
      actorSeatId: viewerSeatId,
      turnId: 'w04-turn',
      deadline: 1793318430000,
      publicEventSequence: 1,
    },
    self: {
      participantId: `p${viewerSeatId}`,
      admission: 'active',
      holeCards: ['AS', 'KS'],
      legalActions: {
        allowed: ['fold', 'check', 'raise', 'allIn'],
        callAmount: 0,
        minRaiseTo: 40,
        maxRaiseTo: 1920,
        allIn: { raiseTo: 1920, additionalAmount: 1900, kind: 'raise' },
      },
    },
  };
}
const two = table(2, [1, 3], 3),
  three = table(3, [0, 2, 3], 2),
  four = table(4, [0, 1, 2, 3], 0);
const computerSeat = three.room.seats[3];
if (computerSeat?.occupant) {
  computerSeat.occupant = {
    ...computerSeat.occupant,
    kind: 'bot',
    difficulty: 'basic',
    online: true,
    ready: null,
    isHost: false,
  };
}
const long = structuredClone(four);
if (long.room.seats[1]?.occupant) long.room.seats[1].occupant.nickname = '小林朋友甲乙丙丁一二三四';
const preflop = structuredClone(two);
preflop.hand.phase = 'preflop';
preflop.hand.board = [];
preflop.hand.potTotal = 30;
preflop.hand.players = preflop.hand.players.map((player) => ({
  ...player,
  stack: player.seatId === 1 ? 1990 : 1980,
  streetCommitted: player.seatId === 1 ? 10 : 20,
  handCommitted: player.seatId === 1 ? 10 : 20,
}));
// The small blind has not responded yet; do not allocate the unmatched big blind.
preflop.hand.pots = [];
preflop.hand.actorSeatId = 1;
preflop.viewerSeatId = 1;
preflop.self = {
  participantId: 'p1',
  admission: 'active',
  holeCards: ['10D', '4C'],
  legalActions: {
    allowed: ['fold', 'call', 'raise', 'allIn'],
    callAmount: 10,
    minRaiseTo: 40,
    maxRaiseTo: 2000,
    allIn: { raiseTo: 2000, additionalAmount: 1990, kind: 'raise' },
  },
};
for (const player of preflop.hand.players) {
  const occupant = preflop.room.seats.find((s) => s.seatId === player.seatId)?.occupant;
  if (occupant) occupant.stack = player.stack;
}
const waiting = structuredClone(four);
waiting.hand.actorSeatId = 1;
if (waiting.self) waiting.self.legalActions = structuredClone(noActions);
const disconnected = structuredClone(four);
disconnected.connection = 'disconnected';
if (disconnected.room.seats[0]?.occupant) disconnected.room.seats[0].occupant.online = false;
if (disconnected.self) disconnected.self.legalActions = structuredClone(noActions);
const next = table(4, [1, 2], 1);
next.viewerSeatId = 0;
next.self = null;
const seat0: PublicSeatView = {
  seatId: 0,
  availability: 'occupied',
  occupant: {
    participantId: 'p0',
    nickname: '小林',
    stack: 0,
    admission: 'waitingNextHand',
    kind: 'human',
    difficulty: null,
    online: true,
    ready: false,
    isHost: false,
  },
};
next.room.seats[0] = seat0;
const allIn = structuredClone(four);
const allInPlayer = allIn.hand.players.find((p) => p.seatId === 0);
if (allInPlayer) {
  allInPlayer.stack = 0;
  allInPlayer.streetCommitted = 1920;
  allInPlayer.handCommitted = 2000;
  allInPlayer.allIn = true;
}
if (allIn.room.seats[0]?.occupant) allIn.room.seats[0].occupant.stack = 0;
allIn.hand.potTotal = 2300;
// Opponents have not responded; only the total is safe to present.
allIn.hand.pots = [];
allIn.hand.actorSeatId = 1;
if (allIn.self) allIn.self.legalActions = structuredClone(noActions);
const threeLobby = room(4, [0, 1, 2], false);
threeLobby.canStart = false;
threeLobby.startBlockReasons = ['PARTICIPANT_NOT_READY'];
if (threeLobby.seats[1]?.occupant) threeLobby.seats[1].occupant.ready = false;
const lobbyComputer = threeLobby.seats[2];
if (lobbyComputer?.occupant) {
  lobbyComputer.occupant = {
    ...lobbyComputer.occupant,
    kind: 'bot',
    difficulty: 'standard',
    online: true,
    ready: null,
    isHost: false,
  };
}
export const fixtures = [
  {
    id: 'lobby-two-of-four',
    label: '等待 · 2/4 可开局',
    page: 'lobby',
    room: room(4, [0, 1], false),
    viewerSeatId: 0,
  },
  {
    id: 'lobby-three-of-four',
    label: '等待 · 3/4 未准备',
    page: 'lobby',
    room: threeLobby,
    viewerSeatId: 0,
  },
  {
    id: 'lobby-alone',
    label: '等待 · 1/4 缺少参与者',
    page: 'lobby',
    room: room(4, [0], false),
    viewerSeatId: 0,
  },
  { id: 'table-two', label: '双人 · 非连续座位', page: 'table', table: two },
  { id: 'table-three', label: '三人 · 非连续座位', page: 'table', table: three },
  { id: 'table-four', label: '四人 · 本人回合', page: 'table', table: four },
  { id: 'table-long-name', label: '四人 · 长昵称与四花色', page: 'table', table: long },
  { id: 'table-preflop', label: '双人 · 翻前五空槽', page: 'table', table: preflop },
  { id: 'table-waiting', label: '四人 · 等待他人', page: 'table', table: waiting },
  { id: 'table-disconnected', label: '四人 · 离线', page: 'table', table: disconnected },
  { id: 'table-next-hand', label: '旁观 · 下一手加入', page: 'table', table: next },
  { id: 'table-all-in', label: '四人 · 本人已全押', page: 'table', table: allIn },
] satisfies GrayboxFixture[];
