/** Allowlisted wire failures. Do not attach raw exceptions or internal state. */
export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_FORBIDDEN'
  | 'INVALID_INPUT'
  | 'NOT_HOST'
  | 'NOT_READY'
  | 'NOT_ENOUGH_PLAYERS'
  | 'HAND_IN_PROGRESS'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_ACTION'
  | 'ILLEGAL_AMOUNT'
  | 'STALE_STATE'
  | 'HAND_MISMATCH'
  | 'TURN_EXPIRED'
  | 'SESSION_EXPIRED'
  | 'SESSION_TAKEN_OVER'
  | 'COMMAND_ID_CONFLICT'
  | 'RATE_LIMITED'
  | 'ROOM_PAUSED'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'REPLAY_FORBIDDEN'
  | 'REPLAY_NOT_FOUND'
  | 'SERVER_RESTARTED';

export interface ServerMeta {
  protocolVersion: 1;
  serverEpoch: string;
  /** Integer Unix timestamp in milliseconds. */
  serverTime: number;
}

export type FieldIssueReason =
  | 'required'
  | 'invalidType'
  | 'outOfRange'
  | 'invalidFormat'
  | 'unknownField';

export interface FieldIssue {
  /** A known request field path, not an echoed exception message. */
  field: string;
  reason: FieldIssueReason;
}

export interface FailureBase extends ServerMeta {
  ok: false;
  code: ErrorCode;
  retryable: boolean;
  retryAfterMs: number | null;
  fieldIssues: FieldIssue[];
  roomId: string | null;
  handId: string | null;
  latestRoomVersion: number | null;
  latestHandVersion: number | null;
}

export interface CommandFailure extends FailureBase {
  /** null only when an invalid commandId cannot be safely correlated. */
  commandId: string | null;
  duplicate: boolean;
}

export interface RequestFailure extends FailureBase {
  /** null only when an invalid requestId cannot be safely correlated. */
  requestId: string | null;
}
