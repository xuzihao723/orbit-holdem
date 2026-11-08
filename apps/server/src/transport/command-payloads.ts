import type { MutatingCommandMap, MutatingEventName, Action } from '@orbit/protocol';
import { normalizeNickname } from '../sessions/input.js';
import { fields, isUuid, integer, oneOf, text, PayloadError } from './input.js';
export const mutatingEvents = [
  'room:create',
  'room:join',
  'room:ready',
  'room:capacity:set',
  'room:bot:add',
  'room:bot:remove',
  'room:start',
  'game:action',
  'room:leave',
  'room:reset:propose',
  'room:reset:cancel',
] as const satisfies readonly MutatingEventName[];
const keys: Record<MutatingEventName, readonly string[]> = {
  'room:create': ['commandId', 'capacity', 'nickname'],
  'room:join': ['commandId', 'roomCode', 'nickname'],
  'room:ready': ['commandId', 'roomId', 'expectedRoomVersion', 'ready'],
  'room:capacity:set': ['commandId', 'roomId', 'expectedRoomVersion', 'capacity'],
  'room:bot:add': ['commandId', 'roomId', 'expectedRoomVersion', 'seatId', 'difficulty'],
  'room:bot:remove': ['commandId', 'roomId', 'expectedRoomVersion', 'seatId'],
  'room:start': ['commandId', 'roomId', 'expectedRoomVersion'],
  'game:action': ['commandId', 'roomId', 'handId', 'turnId', 'expectedVersion', 'action'],
  'room:leave': ['commandId', 'roomId'],
  'room:reset:propose': ['commandId', 'roomId', 'expectedRoomVersion'],
  'room:reset:cancel': ['commandId', 'roomId', 'expectedRoomVersion'],
};
function action(v: unknown): Action {
  const a = fields(v, ['type', 'raiseTo'], ['raiseTo']);
  const type = oneOf(a.type, 'action.type', [
    'fold',
    'check',
    'call',
    'bet',
    'raise',
    'allIn',
  ] as const);
  if (type === 'bet' || type === 'raise') {
    let n: number;
    try {
      n = integer(a.raiseTo, 'action.raiseTo');
    } catch {
      throw new PayloadError('action.raiseTo', 'outOfRange', 'ILLEGAL_AMOUNT');
    }
    return Object.freeze({ type, raiseTo: n });
  }
  if (Object.hasOwn(a, 'raiseTo')) throw new PayloadError('action.raiseTo', 'unknownField');
  return Object.freeze({ type });
}
export function parseMutating<K extends MutatingEventName>(
  event: K,
  value: unknown,
): MutatingCommandMap[K];
export function parseMutating(event: string, value: unknown): MutatingCommandMap[MutatingEventName];
export function parseMutating(
  event: string,
  value: unknown,
): MutatingCommandMap[MutatingEventName] {
  if (!Object.hasOwn(keys, event)) throw new PayloadError('event', 'invalidFormat');
  const r = fields(value, keys[event as MutatingEventName]);
  if (!isUuid(r.commandId)) throw new PayloadError('commandId', 'invalidFormat');
  if ('roomId' in r) r.roomId = text(r.roomId, 'roomId');
  for (const key of ['expectedVersion', 'expectedRoomVersion'])
    if (key in r) r[key] = integer(r[key], key);
  if ('nickname' in r) r.nickname = normalizeNickname(r.nickname);
  if ('capacity' in r) r.capacity = oneOf(r.capacity, 'capacity', [2, 3, 4]);
  if ('seatId' in r) r.seatId = oneOf(r.seatId, 'seatId', [0, 1, 2, 3]);
  if ('ready' in r) r.ready = oneOf(r.ready, 'ready', [true, false]);
  if ('difficulty' in r) r.difficulty = oneOf(r.difficulty, 'difficulty', ['basic', 'standard']);
  if ('roomCode' in r) {
    const code = text(r.roomCode, 'roomCode', 32)
      .trim()
      .replace(/[a-z]/g, (c) => c.toUpperCase());
    if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(code))
      throw new PayloadError('roomCode', 'invalidFormat');
    r.roomCode = code;
  }
  if ('handId' in r) r.handId = text(r.handId, 'handId');
  if ('turnId' in r) r.turnId = text(r.turnId, 'turnId', 256);
  if ('action' in r) r.action = action(r.action);
  return Object.freeze(r) as unknown as MutatingCommandMap[MutatingEventName];
}
