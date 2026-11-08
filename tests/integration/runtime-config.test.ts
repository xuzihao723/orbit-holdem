import { expect, test } from 'vitest';
import { parseRuntimeConfig } from '../../apps/server/src/config/runtime-config.js';
test('production configuration fails before opening any database and forbids serving the data directory', () => {
  expect(() => parseRuntimeConfig({ NODE_ENV: 'production' })).toThrow(
    'PRODUCTION_ORIGIN_REQUIRED',
  );
  expect(() =>
    parseRuntimeConfig({ NODE_ENV: 'production', WEB_ORIGIN: 'http://example.com', WEB_DIST: '.' }),
  ).toThrow();
  expect(() => parseRuntimeConfig({ PORT: '3001junk' })).toThrow();
  expect(() =>
    parseRuntimeConfig({
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://cards.example',
      WEB_DIST: '.data',
      DATABASE_PATH: '.data/orbit.sqlite',
    }),
  ).toThrow();
  expect(parseRuntimeConfig({ PORT: '0' }).port).toBe(0);
});
