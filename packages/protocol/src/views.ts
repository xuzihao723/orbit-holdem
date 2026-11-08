import type {
  ActionType,
  BotDifficulty,
  Capacity,
  SeatId,
} from './commands.js';
import type { CommandFailure, RequestFailure, ServerMeta } from './errors.js';

export type Suit = 'S' | 'H' | 'C' | 'D';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' |
  '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export type CardId = `${Rank}${Suit}`;
export type CardPair = [CardId, CardId];
export type HandCategory = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HandPhase = Street | 'showdown' | 'settled';
export type Admission = 'waitingNextHand' | 'active' | 'eliminated' | 'leaving';
export type RoomStatus = 'waiting' | 'playing' | 'betweenHands' |
  'matchFinished' | 'pausedFault' | 'closed';

export interface OccupantBase {
  participantId: string;
  nickname: string;
  stack: number;
  admission: Admission;
}

export interface HumanOccupant extends OccupantBase {
  kind: 'human';
  difficulty: null;
  online: boolean;
  ready: boolean;
  isHost: boolean;
}

export interface BotOccupant extends OccupantBase {
  kind: 'bot';
  difficulty: BotDifficulty;
  online: true;
  ready: null;
  isHost: false;
}

export type PublicSeatView =
  | { seatId: SeatId; availability: 'open' | 'capacityClosed'; occupant: null }
  | { seatId: SeatId; availability: 'occupied'; occupant: HumanOccupant | BotOccupant };

export type StartBlockReason = 'ROOM_NOT_WAITING' | 'NOT_ENOUGH_PLAYERS' |
  'PARTICIPANT_NOT_READY' | 'PARTICIPANT_OFFLINE' | 'HOST_OFFLINE' |
  'RESET_CONSENT_MISSING' | 'PENDING_BOUNDARY_CHANGE' | 'ROOM_PAUSED';

export interface RoomView extends ServerMeta {
  roomId: string;
  roomCode: string;
  roomVersion: number;
  matchId: string | null;
  currentHandId: string | null;
  capacity: Capacity;
  status: RoomStatus;
  hostParticipantId: string | null;
  seats: PublicSeatView[];
  canStart: boolean;
  startBlockReasons: StartBlockReason[];
  resetProposal: { proposedByParticipantId: string; proposedAt: number } | null;
}

export interface HandSeatView {
  participantId: string;
  seatId: SeatId;
  stack: number;
  streetCommitted: number;
  handCommitted: number;
  folded: boolean;
  allIn: boolean;
  /** Zero before dealing or after public reveal; two while still hidden. */
  hiddenCardCount: 0 | 2;
}

export interface PotView {
  potId: string;
  amount: number;
  eligibleParticipantIds: string[];
}

export interface RevealedCards {
  participantId: string;
  cards: CardPair;
}

export interface HandPublicState {
  roomId: string;
  matchId: string;
  handId: string;
  handVersion: number;
  phase: HandPhase;
  dealerSeatId: SeatId;
  smallBlindSeatId: SeatId;
  bigBlindSeatId: SeatId;
  players: HandSeatView[];
  board: CardId[];
  showdownCards: RevealedCards[];
  pots: PotView[];
  /** Sum of all handCommitted; pot breakdown is not added a second time. */
  potTotal: number;
  actorSeatId: SeatId | null;
  turnId: string | null;
  deadline: number | null;
  publicEventSequence: number;
}

export interface LegalActionsView {
  allowed: ActionType[];
  /** Nominal gap, which may exceed the player's remaining stack. */
  callAmount: number;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  allIn: {
    raiseTo: number;
    additionalAmount: number;
    kind: 'call' | 'bet' | 'raise';
  } | null;
}

export interface PlayerView extends ServerMeta, HandPublicState {
  roomVersion: number;
  self: {
    participantId: string;
    admission: Admission;
    holeCards: CardPair | null;
    legalActions: LegalActionsView;
  };
}

export interface CommandSuccess extends ServerMeta {
  commandId: string;
  ok: true;
  duplicate: boolean;
  roomId: string;
  appliedRoomVersion: number;
  /** These two fields describe an affected hand, not the latest snapshot. */
  handId: string | null;
  appliedHandVersion: number | null;
}

export type CommandAck = CommandSuccess | CommandFailure;

export interface GuestIssued extends ServerMeta {
  requestId: string;
  ok: true;
  sessionId: string;
  resumeToken: string;
  expiresAt: number;
  connectionGeneration: number;
}

export interface ResumeBase extends ServerMeta {
  requestId: string;
  ok: true;
  sessionId: string;
  expiresAt: number;
  connectionGeneration: number;
}

export type SessionResumed = ResumeBase & (
  | {
      outcome: 'seatRestored';
      participantId: string;
      roomView: RoomView;
      playerView: PlayerView | null;
    }
  | {
      outcome: 'identityOnly';
      reason: 'notSeated' | 'seatExpired' | 'roomClosed';
      roomView: null;
      playerView: null;
    }
  | {
      outcome: 'handInterrupted';
      interruptedHandId: string;
      roomView: null;
      playerView: null;
    }
);

export type GuestResponse = GuestIssued | RequestFailure;
export type ResumeResponse = SessionResumed | RequestFailure;

export interface PotAward extends PotView {
  winnerParticipantIds: string[];
  allocations: Array<{ participantId: string; amount: number }>;
  /** null for an uncontested pot without public showdown. */
  winningCategory: HandCategory | null;
}

export interface HandResult {
  roomId: string;
  matchId: string;
  handId: string;
  handVersion: number;
  phase: 'settled';
  board: CardId[];
  showdownCards: RevealedCards[];
  pots: PotAward[];
  refunds: Array<{ participantId: string; amount: number }>;
  finalStacks: Array<{ participantId: string; seatId: SeatId; stack: number }>;
  reason: 'showdown' | 'allOthersFolded';
}

export interface HandResultView extends ServerMeta, HandResult {
  roomVersion: number;
}

export interface HistoryItemBase {
  roomId: string;
  matchId: string;
  handId: string;
  participantId: string;
  playerCount: Capacity;
  startedAt: number;
  endedAt: number;
  startingStack: number;
}

export type HistoryItem = HistoryItemBase & (
  | { status: 'settled'; endingStack: number; netHandChange: number; wonAnyPot: boolean }
  | { status: 'interrupted'; endingStack: null; netHandChange: null; wonAnyPot: null }
);

export interface HistoryPage extends ServerMeta {
  requestId: string;
  ok: true;
  items: HistoryItem[];
  nextCursor: string | null;
}

export type ReplayState = Omit<HandPublicState, 'phase' | 'turnId' | 'deadline'> & {
  phase: HandPhase | 'interrupted';
};

export interface ReplayFrame {
  sequence: number;
  at: number;
  actionText: string;
  state: ReplayState;
  ownerHoleCards: CardPair | null;
}

export interface ReplayView extends ServerMeta {
  requestId: string;
  ok: true;
  handId: string;
  viewerParticipantId: string;
  frames: ReplayFrame[];
  stageStarts: Array<{ phase: HandPhase | 'interrupted'; sequence: number }>;
  result: HandResult | null;
}

export type HistoryResponse = HistoryPage | RequestFailure;
export type ReplayResponse = ReplayView | RequestFailure;

export interface SessionStatus extends ServerMeta {
  status: 'authenticated' | 'reconnecting' | 'takenOver' | 'expired' | 'serverRestarted';
  connectionGeneration: number | null;
}

export interface ServerEventMap {
  'command:ack': CommandAck;
  'room:view': RoomView;
  'game:view': PlayerView;
  'game:result': HandResultView;
  'session:status': SessionStatus;
}

/** Identity/query results use a private response channel correlated by requestId. */
export interface PrivateResponseMap {
  'session:guest': GuestResponse;
  'session:resume': ResumeResponse;
  'history:list': HistoryResponse;
  'replay:get': ReplayResponse;
}
