import { expect, test } from 'vitest';
import {
  createEffectCursor,
  deriveEffects,
} from '../../apps/web/src/features/table/effect-cursor.js';
test('deduplicates bounded effects and never replays initial, disconnected or skipped snapshots', () => {
  const cursor = createEffectCursor({ maxKeys: 2 }),
    effect = { key: 'e:h:1:flip', kind: 'flip' as const, handId: 'h' };
  expect(cursor.accept(effect)).toBe(true);
  expect(cursor.accept(effect)).toBe(false);
  cursor.accept({ ...effect, key: '2' });
  cursor.accept({ ...effect, key: '3' });
  expect(cursor.size).toBe(2);
  const base = {
    epoch: 'e',
    session: 's',
    room: 'r',
    handId: 'h',
    version: 1,
    sequence: 3,
    board: 0,
    holes: 2,
    seats: 2,
    settled: false,
    ready: true,
  };
  const next = { ...base, version: 2, sequence: 7, board: 3 };
  expect(deriveEffects(null, base)).toEqual([]);
  const lobby = { ...base, handId: null, version: 0, sequence: 0, holes: 0 };
  expect(deriveEffects(lobby, base).map((e) => e.kind)).toEqual(['deal']);
  expect(deriveEffects({ ...lobby, ready: false }, base)).toEqual([]);
  expect(deriveEffects(base, next).map((e) => e.kind)).toContain('flip');
  expect(deriveEffects(base, { ...next, version: 9 })).toEqual([]);
  expect(deriveEffects({ ...base, ready: false }, next)).toEqual([]);
  expect(deriveEffects(base, { ...next, session: 'other' })).toEqual([]);
  expect(deriveEffects(next, next)).toEqual([]);
});
