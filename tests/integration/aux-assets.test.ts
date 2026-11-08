import { expect, test } from 'vitest';
import { validateAuxAssets } from '../../scripts/validate-aux-assets.js';
test('all visual aids and both real encodings of five original sounds have provenance', () => {
  const result = validateAuxAssets();
  expect(result).toMatchObject({
    avatars: 8,
    markers: 8,
    textures: 2,
    icons: 12,
    states: 3,
    brand: 2,
    audio: 10,
    sources: 45,
  });
});
