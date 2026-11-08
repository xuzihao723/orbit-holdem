import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import copy from '../../apps/web/src/i18n/zh-CN.json';
import { t } from '../../apps/web/src/i18n/translate.js';
test('each frozen wire error has a plain user message, nine ranks and distinct amount terms', () => {
  const errors = readFileSync('packages/protocol/src/errors.ts', 'utf8').split(
    'export interface',
  )[0]!;
  const codes = [...errors.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
  expect(codes).toHaveLength(23);
  expect(Object.keys(copy.errors).sort()).toEqual(codes.sort());
  expect(copy.ranks).toHaveLength(9);
  expect(t('raiseTo', { amount: 100 })).toBe('加注至 100');
  expect(t('additional', { amount: 80 })).toBe('本次投入 80');
  expect(() => t('raiseTo', { wrong: 1 })).toThrow('COPY_PARAMETER');
  expect(t('not-a-key')).toBe('操作未完成，请稍后重试。');
});
