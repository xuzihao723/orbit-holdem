import { describe, expect, test } from 'vitest';
import type { LegalActionsView } from '@orbit/protocol';
import { resolveRaise, raiseShortcuts } from '../../apps/web/src/features/table/raise-model.js';
import {
  sameActionKey,
  canSubmitAction,
  type ActionKey,
} from '../../apps/web/src/features/table/action-draft.js';
const legal: LegalActionsView = {
  allowed: ['fold', 'call', 'raise', 'allIn'],
  callAmount: 20,
  minRaiseTo: 80,
  maxRaiseTo: 1000,
  allIn: { raiseTo: 1000, additionalAmount: 980, kind: 'raise' },
};
describe('raise input uses total contribution, without guessing server legality', () => {
  test('shows the real additional amount and keeps empty input editable', () => {
    expect(resolveRaise(legal, 20, '100')).toMatchObject({
      raiseTo: 100,
      additionalAmount: 80,
      error: null,
    });
    expect(resolveRaise(legal, 20, '')).toMatchObject({ raiseTo: null, error: 'empty' });
    for (const input of ['1.5', '1e2', '-100', 'NaN', '9007199254740992'])
      expect(resolveRaise(legal, 20, input).error).toBe('integer');
    for (const input of ['79', '1001']) expect(resolveRaise(legal, 20, input).error).toBe('range');
  });
  test('deduplicates clamped shortcuts and never invents a normal raise for a short all-in', () => {
    expect(raiseShortcuts(legal)).toEqual([80, 160, 1000]);
    expect(raiseShortcuts({ ...legal, minRaiseTo: 80, maxRaiseTo: 80, allIn: null })).toEqual([80]);
    const short: LegalActionsView = {
      allowed: ['fold', 'allIn'],
      callAmount: 200,
      minRaiseTo: null,
      maxRaiseTo: null,
      allIn: { raiseTo: 70, additionalAmount: 50, kind: 'call' },
    };
    expect(resolveRaise(short, 20, '70').error).toBe('range');
    expect(raiseShortcuts(short)).toEqual([]);
    expect(raiseShortcuts({ ...legal, allowed: ['fold', 'call'] })).toEqual([]);
  });
});
const key: ActionKey = {
  sessionId: 's',
  participantId: 'p',
  serverEpoch: 'e',
  roomId: 'r',
  handId: 'h',
  turnId: 't',
  handVersion: 2,
  deadline: 30000,
};
test('draft binds identity, epoch, hand, turn, version and deadline; room-only updates are harmless', () => {
  expect(sameActionKey(key, { ...key, roomVersion: 500 } as ActionKey)).toBe(true);
  for (const field of [
    'sessionId',
    'participantId',
    'serverEpoch',
    'roomId',
    'handId',
    'turnId',
  ] as const)
    expect(sameActionKey(key, { ...key, [field]: 'other' })).toBe(false);
  expect(sameActionKey(key, { ...key, handVersion: 3 })).toBe(false);
  expect(sameActionKey(key, { ...key, deadline: 31000 })).toBe(false);
  expect(canSubmitAction(key, key, true, 29999)).toBe(true);
  expect(canSubmitAction(key, key, true, 30000)).toBe(false);
  expect(canSubmitAction(key, key, false, 1)).toBe(false);
  expect(canSubmitAction(key, null, true, 1)).toBe(false);
});
