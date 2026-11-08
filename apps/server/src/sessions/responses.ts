import type { FieldIssue, RequestFailure, ServerMeta } from '@orbit/protocol';
export function sessionMeta(serverEpoch: string, now: number): ServerMeta {
  return {
    protocolVersion: 1,
    serverEpoch,
    serverTime: Number.isSafeInteger(now) && now >= 0 ? now : 0,
  };
}
export function requestFailure(
  meta: ServerMeta,
  requestId: string | null,
  code: 'INVALID_INPUT' | 'SESSION_EXPIRED' | 'SESSION_TAKEN_OVER' | 'PERSISTENCE_UNAVAILABLE',
  fieldIssues: FieldIssue[] = [],
): RequestFailure {
  return Object.freeze({
    ...meta,
    requestId,
    ok: false,
    code,
    retryable: false,
    retryAfterMs: null,
    fieldIssues: fieldIssues.map((i) => Object.freeze({ ...i })),
    roomId: null,
    handId: null,
    latestRoomVersion: null,
    latestHandVersion: null,
  });
}
