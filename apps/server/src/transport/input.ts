import type { FieldIssueReason, ErrorCode } from '@orbit/protocol';
import { SessionPayloadError } from '../sessions/input.js';
export class PayloadError extends SessionPayloadError {
  constructor(
    field: string,
    reason: FieldIssueReason,
    readonly code: ErrorCode = 'INVALID_INPUT',
  ) {
    super(field, reason);
    this.message = code;
  }
}
export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
export function correlationId(v: unknown, field: 'commandId' | 'requestId'): string | null {
  if (!v || typeof v !== 'object') return null;
  const d = Object.getOwnPropertyDescriptor(v, field);
  const x: unknown = d && 'value' in d ? d.value : null;
  return isUuid(x) ? x : null;
}
export function fields(
  v: unknown,
  keys: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(v))
  )
    throw new PayloadError('request', 'invalidType');
  const ds = Object.getOwnPropertyDescriptors(v),
    r: Record<string, unknown> = {};
  if (Reflect.ownKeys(v).some((k) => typeof k !== 'string' || !keys.includes(k)))
    throw new PayloadError('request', 'unknownField');
  for (const key of keys) {
    const d = ds[key];
    if (!d) {
      if (optional.includes(key)) continue;
      throw new PayloadError(key, 'required');
    }
    if (!('value' in d)) throw new PayloadError(key, 'invalidType');
    const x: unknown = d.value;
    r[key] = x;
  }
  return r;
}
export function text(v: unknown, key: string, max = 128): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max || /\p{Cc}/u.test(v))
    throw new PayloadError(key, 'invalidFormat');
  return v;
}
export function integer(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    throw new PayloadError(key, 'outOfRange');
  return v;
}
export function oneOf<T extends string | number | boolean>(
  v: unknown,
  key: string,
  values: readonly T[],
): T {
  const x = values.find((x) => x === v);
  if (x === undefined) throw new PayloadError(key, 'outOfRange');
  return x;
}
