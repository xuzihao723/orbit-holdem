interface Clock {
  setTimer: (callback: () => void, delay: number) => unknown;
  clearTimer: (handle: unknown) => void;
}
export function createReplayPlayer({ clock }: { clock: Clock }) {
  let sequences: readonly number[] = [];
  let state: Readonly<{ index: number; playing: boolean }> = Object.freeze({
    index: 0,
    playing: false,
  });
  let timer: unknown = null,
    disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: typeof state) => {
    state = Object.freeze(next);
    for (const l of listeners) l();
  };
  function pause() {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
    if (state.playing) publish({ ...state, playing: false });
  }
  function tick() {
    timer = null;
    if (disposed || !state.playing) return;
    const index = Math.min(sequences.length - 1, state.index + 1),
      playing = index < sequences.length - 1;
    publish({ index, playing });
    if (playing) timer = clock.setTimer(tick, 1000);
  }
  const seekIndex = (index: number) => {
    pause();
    if (sequences.length)
      publish({
        index: Math.max(0, Math.min(sequences.length - 1, Math.trunc(index))),
        playing: false,
      });
  };
  return {
    get snapshot() {
      return state;
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    load: (values: readonly number[]) => {
      pause();
      if (
        !values.length ||
        values[0] !== 0 ||
        values.some((n, i) => !Number.isSafeInteger(n) || (i > 0 && n <= values[i - 1]!))
      )
        throw Error('INVALID_REPLAY_SEQUENCES');
      sequences = [...values];
      publish({ index: 0, playing: false });
    },
    first: () => seekIndex(0),
    last: () => seekIndex(sequences.length - 1),
    previous: () => seekIndex(state.index - 1),
    next: () => seekIndex(state.index + 1),
    seekIndex,
    seekSequence: (sequence: number) => {
      const i = sequences.indexOf(sequence);
      if (i >= 0) seekIndex(i);
    },
    play: () => {
      if (disposed || state.playing || state.index >= sequences.length - 1) return;
      publish({ ...state, playing: true });
      timer = clock.setTimer(tick, 1000);
    },
    pause,
    dispose: () => {
      disposed = true;
      pause();
      sequences = [];
      listeners.clear();
    },
  };
}
