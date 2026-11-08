import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReplayFrame } from '@orbit/protocol';
import { createReplayPlayer } from './replay-player';
export function useReplayPlayer(frames: readonly ReplayFrame[]) {
  const [player] = useState(() =>
    createReplayPlayer({
      clock: {
        setTimer: (f, ms) => setTimeout(f, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
    }),
  );
  const state = useSyncExternalStore(
    player.subscribe,
    () => player.snapshot,
    () => player.snapshot,
  );
  useEffect(() => {
    player.load(frames.map((f) => f.sequence));
    return () => player.pause();
  }, [frames, player]);
  return { player, state };
}
