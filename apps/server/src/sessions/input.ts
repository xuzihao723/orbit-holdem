import type {
  FieldIssue,
  FieldIssueReason,
  SessionGuestRequest,
  SessionResumeRequest,
} from '@orbit/protocol';
export class SessionPayloadError extends Error {
  readonly fieldIssues: FieldIssue[];
  constructor(field: string, reason: FieldIssueReason) {
    super('INVALID_INPUT');
    this.name = 'SessionPayloadError';
    this.fieldIssues = [{ field, reason }];
  }
}
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function requestIdOf(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const d = Object.getOwnPropertyDescriptor(value, 'requestId');
  const id: unknown = d && 'value' in d ? d.value : null;
  return isUuid(id) ? id : null;
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SessionPayloadError('request', 'invalidType');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype)
    throw new SessionPayloadError('request', 'invalidType');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some((k) => typeof k !== 'string' || !keys.includes(k)))
    throw new SessionPayloadError('request', 'unknownField');
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const d = descriptors[key];
    if (!d) throw new SessionPayloadError(key, 'required');
    if (!('value' in d)) throw new SessionPayloadError(key, 'invalidType');
    const v: unknown = d.value;
    result[key] = v;
  }
  return result;
}
export function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string') throw new SessionPayloadError('nickname', 'invalidType');
  if (/\p{Cc}/u.test(value)) throw new SessionPayloadError('nickname', 'invalidFormat');
  const nickname = value.trim(),
    length = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(nickname)]
      .length;
  if (length < 1 || length > 12) throw new SessionPayloadError('nickname', 'outOfRange');
  return nickname;
}
function nullableId(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || /\p{Cc}/u.test(value))
    throw new SessionPayloadError(field, 'invalidType');
  return value;
}
function nullableVersion(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new SessionPayloadError(field, 'outOfRange');
  return value;
}
export function parseSessionGuestPayload(value: unknown): SessionGuestRequest {
  const r = object(value, ['requestId', 'nickname']);
  if (!isUuid(r.requestId)) throw new SessionPayloadError('requestId', 'invalidFormat');
  return { requestId: r.requestId, nickname: normalizeNickname(r.nickname) };
}
export function parseSessionResumePayload(value: unknown): SessionResumeRequest {
  const r = object(value, [
    'requestId',
    'resumeToken',
    'roomId',
    'lastSeenHandId',
    'lastSeenRoomVersion',
    'lastSeenHandVersion',
  ]);
  if (!isUuid(r.requestId)) throw new SessionPayloadError('requestId', 'invalidFormat');
  if (typeof r.resumeToken !== 'string')
    throw new SessionPayloadError('resumeToken', 'invalidType');
  return {
    requestId: r.requestId,
    resumeToken: r.resumeToken,
    roomId: nullableId(r.roomId, 'roomId'),
    lastSeenHandId: nullableId(r.lastSeenHandId, 'lastSeenHandId'),
    lastSeenRoomVersion: nullableVersion(r.lastSeenRoomVersion, 'lastSeenRoomVersion'),
    lastSeenHandVersion: nullableVersion(r.lastSeenHandVersion, 'lastSeenHandVersion'),
  };
}
export function parseAccountResumePayload(
  value: unknown,
): Omit<SessionResumeRequest, 'resumeToken'> {
  const r = object(value, [
    'requestId',
    'roomId',
    'lastSeenHandId',
    'lastSeenRoomVersion',
    'lastSeenHandVersion',
  ]);
  if (!isUuid(r.requestId)) throw new SessionPayloadError('requestId', 'invalidFormat');
  return {
    requestId: r.requestId,
    roomId: nullableId(r.roomId, 'roomId'),
    lastSeenHandId: nullableId(r.lastSeenHandId, 'lastSeenHandId'),
    lastSeenRoomVersion: nullableVersion(r.lastSeenRoomVersion, 'lastSeenRoomVersion'),
    lastSeenHandVersion: nullableVersion(r.lastSeenHandVersion, 'lastSeenHandVersion'),
  };
}
