import scenarios from '../fixtures/scenarios.json';
import type { CardId, SeatId } from '../../packages/poker-core/src/index.js';
export function record(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new Error('INVALID_FIXTURE_OBJECT');
  return v as Record<string, unknown>;
}
export function array(v: unknown): unknown[] {
  if (!Array.isArray(v)) throw new Error('INVALID_FIXTURE_ARRAY');
  return v;
}
export function integer(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
    throw new Error('INVALID_FIXTURE_INTEGER');
  return v;
}
export function bool(v: unknown): boolean {
  if (typeof v !== 'boolean') throw new Error('INVALID_FIXTURE_BOOLEAN');
  return v;
}
export function text(v: unknown): string {
  if (typeof v !== 'string') throw new Error('INVALID_FIXTURE_STRING');
  return v;
}
export function seat(v: unknown): SeatId {
  if (v !== 0 && v !== 1 && v !== 2 && v !== 3) throw new Error('INVALID_FIXTURE_SEAT');
  return v;
}
export function seats(v: unknown): SeatId[] {
  return array(v).map(seat);
}
export function cards(v: unknown): CardId[] {
  return array(v).map((item) => {
    if (typeof item !== 'string' || !/^(?:[2-9]|10|J|Q|K|A)[SHCD]$/.test(item))
      throw new Error('INVALID_FIXTURE_CARD');
    return item as CardId;
  });
}
export function numbers(v: unknown): number[] {
  return array(v).map(integer);
}
export function scenario(id: string, operations: readonly string[]) {
  const rows = scenarios.filter((r) => r.id === id);
  if (rows.length !== 1) throw new Error('MISSING_OR_DUPLICATE_FIXTURE:' + id);
  const r = rows[0];
  if (!r || !operations.includes(r.when.operation))
    throw new Error('INVALID_FIXTURE_OPERATION:' + id);
  return { given: record(r.given), when: record(r.when), expected: record(r.expected) };
}
