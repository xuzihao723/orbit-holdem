import { isCardId, type CardId } from '@orbit/poker-core';
import type { ErrorCode, MutatingEventName } from '@orbit/protocol';
import { invalid } from './errors.js';
import {
  object,
  fields,
  text,
  integer,
  positive,
  boolean,
  nullableText,
  nullableInteger,
  array,
  seat,
  seatList,
  choice,
  hash,
  uuid,
  scope,
  type EventInsert,
  type ReceiptInsert,
} from './rows.js';
const codes: Record<ErrorCode, true> = {
  ROOM_NOT_FOUND: true,
  ROOM_FULL: true,
  ROOM_FORBIDDEN: true,
  INVALID_INPUT: true,
  NOT_HOST: true,
  NOT_READY: true,
  NOT_ENOUGH_PLAYERS: true,
  HAND_IN_PROGRESS: true,
  NOT_YOUR_TURN: true,
  ILLEGAL_ACTION: true,
  ILLEGAL_AMOUNT: true,
  STALE_STATE: true,
  HAND_MISMATCH: true,
  TURN_EXPIRED: true,
  SESSION_EXPIRED: true,
  SESSION_TAKEN_OVER: true,
  COMMAND_ID_CONFLICT: true,
  RATE_LIMITED: true,
  ROOM_PAUSED: true,
  PERSISTENCE_UNAVAILABLE: true,
  REPLAY_FORBIDDEN: true,
  REPLAY_NOT_FOUND: true,
  SERVER_RESTARTED: true,
};
const mutating = [
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
function cards(value: unknown, count: number): CardId[] {
  const result = array(value).map((c) => {
    if (!isCardId(c)) invalid();
    return c;
  });
  if (result.length !== count || new Set(result).size !== count) invalid();
  return result;
}
function pot(value: unknown): void {
  const p = fields(value, [
    'potId',
    'lowerExclusive',
    'upperInclusive',
    'amount',
    'contributorSeatIds',
    'eligibleSeatIds',
    'winnerSeatIds',
    'allocations',
    'winningCategory',
  ]);
  const lower = integer(p.lowerExclusive),
    upper = positive(p.upperInclusive),
    amount = positive(p.amount),
    contributors = seatList(p.contributorSeatIds),
    eligible = seatList(p.eligibleSeatIds),
    winners = seatList(p.winnerSeatIds);
  if (
    upper <= lower ||
    text(p.potId) !== `pot:${lower}:${upper}` ||
    !eligible.length ||
    !winners.length ||
    eligible.some((s) => !contributors.includes(s)) ||
    winners.some((s) => !eligible.includes(s)) ||
    amount !== (upper - lower) * contributors.length
  )
    invalid();
  if (p.winningCategory !== null && integer(p.winningCategory) > 8) invalid();
  const allocations = array(p.allocations).map((a) => {
    const r = fields(a, ['seatId', 'amount']);
    return { seatId: seat(r.seatId), amount: integer(r.amount) };
  });
  if (
    allocations.length !== winners.length ||
    new Set(allocations.map((a) => a.seatId)).size !== allocations.length ||
    allocations.some((a) => !winners.includes(a.seatId)) ||
    allocations.reduce((s, a) => s + a.amount, 0) !== amount
  )
    invalid();
}
export function validateEvent(e: EventInsert): void {
  fields(e, [
    'handId',
    'sequence',
    'handVersion',
    'kind',
    'payload',
    'visibility',
    'ownerParticipantId',
    'occurredAt',
  ]);
  text(e.handId);
  positive(e.sequence);
  positive(e.handVersion);
  integer(e.occurredAt);
  nullableText(e.ownerParticipantId);
  const kind = choice(e.kind, [
    'handStarted',
    'blindPosted',
    'holeDealt',
    'actionApplied',
    'cardBurned',
    'boardDealt',
    'refunded',
    'potsBuilt',
    'showdownRevealed',
    'paidOut',
    'handSettled',
  ]);
  if (
    e.visibility !==
      (kind === 'holeDealt' ? 'owner' : kind === 'cardBurned' ? 'internal' : 'public') ||
    (e.visibility === 'owner') !== (e.ownerParticipantId !== null)
  )
    invalid();
  if (kind === 'handStarted') {
    const r = fields(e.payload, ['dealerSeatId', 'seats']);
    const ids = seatList(r.seats);
    if (ids.length < 2 || ids.length > 4 || !ids.includes(seat(r.dealerSeatId))) invalid();
  }
  if (kind === 'blindPosted' || kind === 'refunded') {
    const r = fields(e.payload, ['seatId', 'amount']);
    seat(r.seatId);
    positive(r.amount);
  }
  if (kind === 'holeDealt') {
    const r = fields(e.payload, ['seatId', 'cards']);
    seat(r.seatId);
    cards(r.cards, 2);
  }
  if (kind === 'actionApplied') {
    const r = fields(e.payload, ['seatId', 'actionType', 'paidAmount', 'raiseTo']);
    seat(r.seatId);
    choice(r.actionType, ['fold', 'check', 'call', 'bet', 'raise', 'allIn']);
    integer(r.paidAmount);
    nullableInteger(r.raiseTo);
  }
  // Production history stores the fact of burning, not an unnecessary card ID.
  if (kind === 'cardBurned') {
    const r = fields(e.payload, ['count']);
    if (r.count !== 1) invalid();
  }
  if (kind === 'boardDealt') {
    const r = fields(e.payload, ['street', 'cards']);
    const street = choice(r.street, ['flop', 'turn', 'river']);
    cards(r.cards, street === 'flop' ? 3 : 1);
  }
  if (kind === 'potsBuilt') {
    const r = fields(e.payload, ['pots']);
    array(r.pots).forEach(pot);
  }
  if (kind === 'showdownRevealed') {
    const r = fields(e.payload, ['cards']),
      ids: number[] = [];
    for (const value of array(r.cards)) {
      const p = fields(value, ['seatId', 'cards']),
        id = seat(p.seatId);
      if (ids.includes(id)) invalid();
      ids.push(id);
      cards(p.cards, 2);
    }
  }
  if (kind === 'paidOut') {
    const r = fields(e.payload, ['seatId', 'potId', 'amount']);
    seat(r.seatId);
    text(r.potId);
    integer(r.amount);
  }
  if (kind === 'handSettled') {
    const r = fields(e.payload, ['reason']);
    choice(r.reason, ['showdown', 'allOthersFolded']);
  }
}
export function validateReceipt(receipt: ReceiptInsert): void {
  fields(receipt, [
    'actorScope',
    'commandId',
    'payloadHash',
    'event',
    'result',
    'roomId',
    'appliedRoomVersion',
    'handId',
    'appliedHandVersion',
    'createdAt',
  ]);
  scope(receipt.actorScope);
  uuid(receipt.commandId);
  hash(receipt.payloadHash);
  choice(receipt.event, mutating);
  nullableText(receipt.roomId);
  nullableInteger(receipt.appliedRoomVersion);
  nullableText(receipt.handId);
  nullableInteger(receipt.appliedHandVersion);
  integer(receipt.createdAt);
  if ((receipt.handId === null) !== (receipt.appliedHandVersion === null)) invalid();
  const candidate = object(receipt.result),
    descriptor = Object.getOwnPropertyDescriptor(candidate, 'ok');
  if (!descriptor || !('value' in descriptor)) invalid();
  const success: unknown = descriptor.value;
  const base = ['protocolVersion', 'serverEpoch', 'serverTime', 'commandId', 'ok', 'duplicate'],
    r0 = fields(
      candidate,
      success === true
        ? [...base, 'roomId', 'appliedRoomVersion', 'handId', 'appliedHandVersion']
        : [
            ...base,
            'code',
            'retryable',
            'retryAfterMs',
            'fieldIssues',
            'roomId',
            'handId',
            'latestRoomVersion',
            'latestHandVersion',
          ],
    );
  if (r0.protocolVersion !== 1 || uuid(r0.commandId) !== receipt.commandId) invalid();
  text(r0.serverEpoch);
  integer(r0.serverTime);
  boolean(r0.duplicate);
  const ok = boolean(r0.ok);
  if (ok) {
    text(r0.roomId);
    integer(r0.appliedRoomVersion);
    nullableText(r0.handId);
    nullableInteger(r0.appliedHandVersion);
    if (
      r0.roomId !== receipt.roomId ||
      r0.appliedRoomVersion !== receipt.appliedRoomVersion ||
      r0.handId !== receipt.handId ||
      r0.appliedHandVersion !== receipt.appliedHandVersion
    )
      invalid();
  } else {
    if (typeof r0.code !== 'string' || !Object.hasOwn(codes, r0.code)) invalid();
    boolean(r0.retryable);
    const retry = nullableInteger(r0.retryAfterMs);
    if (
      r0.code === 'RATE_LIMITED'
        ? r0.retryable !== true || retry === null || retry === 0
        : r0.retryable !== false || retry !== null
    )
      invalid();
    nullableText(r0.roomId);
    nullableText(r0.handId);
    nullableInteger(r0.latestRoomVersion);
    nullableInteger(r0.latestHandVersion);
    for (const value of array(r0.fieldIssues)) {
      const issue = fields(value, ['field', 'reason']);
      if (!/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*$/.test(text(issue.field))) invalid();
      choice(issue.reason, [
        'required',
        'invalidType',
        'outOfRange',
        'invalidFormat',
        'unknownField',
      ]);
    }
    if (
      receipt.appliedRoomVersion !== null ||
      receipt.handId !== null ||
      receipt.appliedHandVersion !== null ||
      r0.roomId !== receipt.roomId
    )
      invalid();
  }
}
