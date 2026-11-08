/** W02 wire payloads. Runtime validation is required before trusting any input. */
export type Capacity = 2 | 3 | 4;
export type SeatId = 0 | 1 | 2 | 3;
export type BotDifficulty = 'basic' | 'standard';
export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'bet'; raiseTo: number }
  | { type: 'raise'; raiseTo: number }
  | { type: 'allIn' };
export type ActionType = Action['type'];

export interface CommandBase {
  commandId: string;
}

export interface RoomCommandBase extends CommandBase {
  /** Routing hint, never proof of membership or control. */
  roomId: string;
}

export interface VersionedRoomCommand extends RoomCommandBase {
  expectedRoomVersion: number;
}

export interface RequestBase {
  requestId: string;
}

export interface SessionGuestRequest extends RequestBase {
  nickname: string;
}

export interface SessionResumeRequest extends RequestBase {
  resumeToken: string;
  roomId: string | null;
  lastSeenHandId: string | null;
  lastSeenRoomVersion: number | null;
  lastSeenHandVersion: number | null;
}

export interface CreateRoomCommand extends CommandBase {
  capacity: Capacity;
  nickname: string;
}

export interface JoinRoomCommand extends CommandBase {
  roomCode: string;
  nickname: string;
}

export interface ReadyCommand extends VersionedRoomCommand {
  ready: boolean;
}

export interface SetCapacityCommand extends VersionedRoomCommand {
  capacity: Capacity;
}

export interface AddBotCommand extends VersionedRoomCommand {
  seatId: SeatId;
  difficulty: BotDifficulty;
}

export interface RemoveBotCommand extends VersionedRoomCommand {
  seatId: SeatId;
}

export interface StartRoomCommand extends VersionedRoomCommand {}

export interface GameActionCommand extends RoomCommandBase {
  handId: string;
  turnId: string;
  /** Always handVersion, never roomVersion. */
  expectedVersion: number;
  action: Action;
}

export interface LeaveRoomCommand extends RoomCommandBase {}
export interface ProposeResetCommand extends VersionedRoomCommand {}
export interface CancelResetCommand extends VersionedRoomCommand {}

export interface HistoryListRequest extends RequestBase {
  cursor: string | null;
  /** Omitted means 20; accepted range is 1..50. */
  limit?: number;
}

export interface ReplayGetRequest extends RequestBase {
  handId: string;
}

export interface IdentityRequestMap {
  'session:guest': SessionGuestRequest;
  'session:resume': SessionResumeRequest;
}

export interface MutatingCommandMap {
  'room:create': CreateRoomCommand;
  'room:join': JoinRoomCommand;
  'room:ready': ReadyCommand;
  'room:capacity:set': SetCapacityCommand;
  'room:bot:add': AddBotCommand;
  'room:bot:remove': RemoveBotCommand;
  'room:start': StartRoomCommand;
  'game:action': GameActionCommand;
  'room:leave': LeaveRoomCommand;
  'room:reset:propose': ProposeResetCommand;
  'room:reset:cancel': CancelResetCommand;
}

export interface QueryRequestMap {
  'history:list': HistoryListRequest;
  'replay:get': ReplayGetRequest;
}

export interface ClientRequestMap
  extends IdentityRequestMap, MutatingCommandMap, QueryRequestMap {}

export type ClientEventName = keyof ClientRequestMap;
export type MutatingEventName = keyof MutatingCommandMap;
