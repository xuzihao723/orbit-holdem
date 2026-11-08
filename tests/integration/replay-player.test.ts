import { expect, test } from 'vitest';
import { FakeClock } from '../helpers/fake-clock.js';
import { createReplayPlayer } from '../../apps/web/src/features/replay/replay-player.js';
test('noncontinuous sequences are indexes only when explicitly selected, and dispose removes timers', async () => {
  const clock = new FakeClock(),
    player = createReplayPlayer({ clock });
  player.load([0, 1, 5, 9]);
  player.play();
  await clock.advanceTo(1000);
  expect(player.snapshot.index).toBe(1);
  player.seekSequence(9);
  expect(player.snapshot).toMatchObject({ index: 3, playing: false });
  player.next();
  expect(player.snapshot.index).toBe(3);
  player.first();
  player.play();
  player.dispose();
  expect(clock.pending).toBe(0);
  await clock.advanceTo(10000);
  expect(player.snapshot.playing).toBe(false);
});
