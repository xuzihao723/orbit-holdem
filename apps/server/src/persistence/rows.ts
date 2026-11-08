import type { HandRepositories } from './hand-rows.js';
import type { HistoryReadRepository } from './history-rows.js';
import type { RoomRepositories } from './domain-rows.js';
import { invalid } from './errors.js';
import type { SeatId } from '@orbit/poker-core';
export interface PersistenceConfig {
  readonly path: string;
  readonly busyTimeoutMs: number;
  readonly readOnly?: boolean;
}
export interface StoredSession {
  readonly sessionId: string;
  readonly tokenHash: string;
  readonly nickname: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly connectionGeneration: number;
}
export interface EventInsert {
  readonly handId: string;
  readonly sequence: number;
  readonly handVersion: number;
  readonly kind: string;
  readonly payload: unknown;
  readonly visibility: 'public' | 'owner' | 'internal';
  readonly ownerParticipantId: string | null;
  readonly occurredAt: number;
}
export interface ReceiptInsert {
  readonly actorScope: string;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly event: string;
  readonly result: unknown;
  readonly roomId: string | null;
  readonly appliedRoomVersion: number | null;
  readonly handId: string | null;
  readonly appliedHandVersion: number | null;
  readonly createdAt: number;
}
export interface AppliedBatch {
  readonly events: readonly EventInsert[];
  readonly receipt: ReceiptInsert;
  readonly handVersionUpdate: {
    readonly handId: string;
    readonly expected: number;
    readonly next: number;
  } | null;
}
export interface HandOwnership {
  readonly handId: string;
  readonly roomId: string;
  readonly status: 'active' | 'settled' | 'interrupted';
  readonly startEpoch: string;
}
export interface ParticipantOwnership {
  readonly participantId: string;
  readonly leftAt: number | null;
  readonly roomStatus:
    'waiting' | 'playing' | 'betweenHands' | 'matchFinished' | 'pausedFault' | 'closed';
  readonly serverEpoch: string;
}
export interface LedgerInsert {
  readonly entryId: string;
  readonly roomId: string;
  readonly matchId: string;
  readonly participantId: string;
  readonly type: 'seat_grant' | 'seat_cashout' | 'match_reset_remove' | 'match_reset_grant';
  readonly delta: number;
  readonly reason: string;
  readonly occurredAt: number;
  readonly sourceActorScope: string | null;
  readonly sourceCommandId: string | null;
  readonly sourceSystemEventId: string | null;
}
export interface PersistenceRepositories extends HistoryReadRepository {
  findInternalReceipt(scope: string, commandId: string): ReceiptInsert | null;
  insertSession(session: StoredSession): void;
  findSessionByTokenHash(hash: string): StoredSession | null;
  findSessionById(id: string): StoredSession | null;
  incrementSessionGeneration(input: {
    readonly sessionId: string;
    readonly expected: number;
    readonly now: number;
  }): StoredSession;
  commitAppliedCommand(batch: AppliedBatch): void;
  findReceipt(scope: string, commandId: string): ReceiptInsert | null;
  listOwnedHandIds(sessionId: string): readonly string[];
  findOwnedHand(sessionId: string, handId: string): HandOwnership | null;
  findOwnedParticipantInRoom(sessionId: string, roomId: string): ParticipantOwnership | null;
  appendLedger(entry: LedgerInsert): void;
  listLedger(roomId: string): readonly LedgerInsert[];
}
export interface PokerDatabase {
  readonly accounts: ReturnType<typeof import('./account-repository.js').accountRepository>;
  archivePreviousEpoch(input: { serverEpoch: string; now: number }): { archivedRooms: number };
  commitBoundary(batch: import('./domain-rows.js').BoundaryCommit): void;
  readonly hands: HandRepositories;
  readonly rooms: RoomRepositories;
  readonly repositories: PersistenceRepositories;
  migrate(): void;
  close(): void;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
export function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const r = object(value),
    prototype = Object.getPrototypeOf(r);
  if (
    (prototype !== null && prototype !== Object.prototype) ||
    Reflect.ownKeys(r).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(r, k)) ||
    Object.values(Object.getOwnPropertyDescriptors(r)).some((d) => !('value' in d))
  )
    invalid();
  return r;
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /\p{Cc}/u.test(value)) invalid();
  return value;
}
export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
export function positive(value: unknown): number {
  const n = integer(value);
  if (n === 0) invalid();
  return n;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}
export function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
export function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  if (
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    invalid();
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) invalid();
    const item: unknown = descriptor.value;
    result.push(item);
  }
  return result;
}
export function seat(value: unknown): SeatId {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) invalid();
  return value;
}
export function seatList(value: unknown): SeatId[] {
  const v = array(value).map(seat);
  if (new Set(v).size !== v.length) invalid();
  return v;
}
export function choice<const T extends string>(value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((v) => v === value);
  if (found === undefined) invalid();
  return found;
}
export function hash(value: unknown): string {
  const v = text(value);
  if (!/^[0-9a-f]{64}$/.test(v)) invalid();
  return v;
}
export function uuid(value: unknown): string {
  const v = text(value);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)) invalid();
  return v;
}
export function scope(value: unknown): string {
  const v = text(value);
  if (!/^(session|bot|system):\S+$/.test(v)) invalid();
  return v;
}
export function json(value: unknown): unknown {
  try {
    return JSON.parse(text(value)) as unknown;
  } catch {
    invalid();
  }
}
export function encode(value: unknown): string {
  const result = JSON.stringify(canonicalJson(value));
  if (typeof result !== 'string') invalid();
  return result;
}
function canonicalJson(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) invalid();
    return value;
  }
  if (!value || typeof value !== 'object' || ancestors.has(value)) invalid();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return array(value).map((v) => canonicalJson(v, ancestors));
    const r = fields(value, Object.keys(object(value)));
    return Object.fromEntries(
      Object.entries(r).map(([key, v]) => [key, canonicalJson(v, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}
export function validateSession(s: StoredSession): void {
  fields(s, [
    'sessionId',
    'tokenHash',
    'nickname',
    'createdAt',
    'expiresAt',
    'connectionGeneration',
  ]);
  text(s.sessionId);
  hash(s.tokenHash);
  const nick = text(s.nickname);
  if ([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(nick)].length > 12)
    invalid();
  integer(s.createdAt);
  integer(s.expiresAt);
  positive(s.connectionGeneration);
  if (s.expiresAt <= s.createdAt) invalid();
}
export function sessionRow(value: unknown): StoredSession {
  const r = object(value),
    s = {
      sessionId: text(r.session_id),
      tokenHash: hash(r.token_hash),
      nickname: text(r.nickname),
      createdAt: integer(r.created_at),
      expiresAt: integer(r.expires_at),
      connectionGeneration: positive(r.connection_generation),
    };
  validateSession(s);
  return Object.freeze(s);
}
