import { expect, test } from 'vitest';
import { createPreferencesStore } from '../../apps/web/src/settings/preferences-store.js';
test('defaults are silent, closed preferences survive storage denial and refresh across tabs', () => {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, text: string) => {
      value = text;
    },
  };
  const a = createPreferencesStore(storage, true),
    b = createPreferencesStore(storage, false);
  expect(a.snapshot).toMatchObject({
    soundEnabled: false,
    reduceMotion: true,
    suitMode: 'standard',
    cardBack: 'orbit',
    theme: 'orbit',
  });
  const initial = a.snapshot;
  expect(a.snapshot).toBe(initial);
  a.update({ suitMode: 'four', cardBack: 'orbit-simple', soundEnabled: true });
  b.refresh();
  expect(b.snapshot).toMatchObject({
    suitMode: 'four',
    cardBack: 'orbit-simple',
    soundEnabled: true,
  });
  value = '{"version":1,"soundEnabled":"yes"}';
  a.refresh();
  expect(a.snapshot.soundEnabled).toBe(false);
  value = 'broken';
  b.refresh();
  expect(b.snapshot.soundEnabled).toBe(false);
  const denied = createPreferencesStore({
    getItem: () => {
      throw Error('denied');
    },
    setItem: () => {
      throw Error('denied');
    },
  });
  denied.update({ soundEnabled: true });
  expect(denied.snapshot.soundEnabled).toBe(true);
  expect(value).not.toContain('session');
});
