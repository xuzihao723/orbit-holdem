import { expect, test } from 'vitest';
import { createDeck } from '@orbit/poker-core';
import { buildCardSet } from '../../scripts/generate-cards.js';
import { validateCardSet } from '../../scripts/validate-assets.js';
test('52 faces, two distinct backs and one slot are deterministic and form a bijection', () => {
  const a = buildCardSet(),
    b = buildCardSet();
  expect(a).toEqual(b);
  expect(Object.keys(a.manifest.faces).sort()).toEqual(createDeck().sort());
  expect(new Set(Object.values(a.manifest.faces)).size).toBe(52);
  expect(a.manifest.backs).toHaveLength(2);
  expect(Object.keys(a.files)).toHaveLength(55);
  expect(validateCardSet(a).faceCount).toBe(52);
  expect(a.files['cards/faces/10H.svg']).toContain('data-rank="10"');
});
test('rejects missing, swapped, unsafe and incorrect-pip actual SVGs', () => {
  for (const mutate of [
    (set: ReturnType<typeof buildCardSet>) => {
      delete set.files['cards/faces/10H.svg'];
    },
    (set: ReturnType<typeof buildCardSet>) => {
      set.manifest.faces['10H'] = set.manifest.faces.JH!;
    },
    (set: ReturnType<typeof buildCardSet>) => {
      set.files['cards/faces/7H.svg'] = set.files['cards/faces/7H.svg']!.replace(
        '</svg>',
        '<image href="https://invalid/x"/></svg>',
      );
    },
    (set: ReturnType<typeof buildCardSet>) => {
      set.files['cards/faces/7H.svg'] = set.files['cards/faces/7H.svg']!.replace(
        'data-pip-index="0"',
        'data-wrong-index="0"',
      );
    },
    (set: ReturnType<typeof buildCardSet>) => {
      set.manifest.faces['10H'] = '../private.sqlite';
    },
  ]) {
    const set = buildCardSet();
    mutate(set);
    expect(() => validateCardSet(set)).toThrow();
  }
});
