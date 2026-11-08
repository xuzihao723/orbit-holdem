import { expect, test } from 'vitest';
import { AudioManager } from '../../apps/web/src/audio/audio-manager.js';
test('sound requires an explicit gesture, stays bounded, and disabling cancels fallback handlers', () => {
  const voices: { paused: boolean; onerror: (() => void) | null; onended: (() => void) | null }[] =
    [];
  const manager = new AudioManager((src) => {
    const v = {
      paused: false,
      src,
      volume: 0,
      onerror: null as (() => void) | null,
      onended: null as (() => void) | null,
      play: () => Promise.resolve(),
      pause() {
        this.paused = true;
      },
      removeAttribute() {},
      load() {},
    };
    voices.push(v);
    return v as unknown as HTMLAudioElement;
  });
  manager.play('deal', true);
  expect(voices).toHaveLength(0);
  manager.unlock();
  manager.play('deal', false);
  expect(voices).toHaveLength(0);
  for (let i = 0; i < 5; i++) manager.play('action', true);
  expect(voices).toHaveLength(5);
  expect(voices[0]!.paused).toBe(true);
  manager.stop();
  expect(voices.every((v) => v.paused && v.onerror === null && v.onended === null)).toBe(true);
});
