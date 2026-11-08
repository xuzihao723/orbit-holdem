import type {
  CommandFailure,
  RequestFailure,
  ErrorCode,
  FieldIssue,
  ServerMeta,
} from '@orbit/protocol';
import { correlationId } from './input.js';
export function commandFailure(
  meta: ServerMeta,
  raw: unknown,
  code: ErrorCode,
  issues: FieldIssue[] = [],
  wait: number | null = null,
): CommandFailure {
  return {
    ...meta,
    ok: false,
    commandId: correlationId(raw, 'commandId'),
    duplicate: false,
    code,
    retryable: code === 'RATE_LIMITED',
    retryAfterMs: code === 'RATE_LIMITED' ? wait : null,
    fieldIssues: issues,
    roomId: null,
    handId: null,
    latestRoomVersion: null,
    latestHandVersion: null,
  };
}
export function privateFailure(
  meta: ServerMeta,
  raw: unknown,
  code: ErrorCode,
  wait: number | null = null,
): RequestFailure {
  const { commandId: _, duplicate: __, ...rest } = commandFailure(meta, raw, code, [], wait);
  return { ...rest, requestId: correlationId(raw, 'requestId') };
}
