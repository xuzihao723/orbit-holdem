export interface Preferences {
  version: 1;
  soundEnabled: boolean;
  reduceMotion: boolean;
  suitMode: 'standard' | 'four';
  cardBack: 'orbit' | 'orbit-simple';
  theme: 'orbit';
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const key = 'orbit.preferences.v1';
export function createPreferencesStore(storage?: StorageLike, systemReduced = false) {
  const defaults = (): Preferences => ({
    version: 1,
    soundEnabled: false,
    reduceMotion: systemReduced,
    suitMode: 'standard',
    cardBack: 'orbit',
    theme: 'orbit',
  });
  function read(): Preferences {
    try {
      const v: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
      if (!v || typeof v !== 'object' || Array.isArray(v)) return defaults();
      const x = v as Record<string, unknown>;
      if (
        Object.keys(x).sort().join() !==
          'cardBack,reduceMotion,soundEnabled,suitMode,theme,version' ||
        x.version !== 1 ||
        typeof x.soundEnabled !== 'boolean' ||
        typeof x.reduceMotion !== 'boolean' ||
        !['standard', 'four'].includes(String(x.suitMode)) ||
        !['orbit', 'orbit-simple'].includes(String(x.cardBack)) ||
        x.theme !== 'orbit'
      )
        return defaults();
      return { ...x } as unknown as Preferences;
    } catch {
      return defaults();
    }
  }
  let value = Object.freeze(read());
  const listeners = new Set<() => void>();
  function publish(next: Preferences) {
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    value = Object.freeze(next);
    for (const l of listeners) l();
  }
  return {
    get snapshot() {
      return value;
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    refresh: () => publish(read()),
    update: (patch: Partial<Omit<Preferences, 'version' | 'theme'>>) => {
      const next = { ...value, ...patch };
      publish(next);
      try {
        storage?.setItem(key, JSON.stringify(next));
      } catch {
        /* Keep usable in-memory settings. */
      }
    },
  };
}
let browserStore: ReturnType<typeof createPreferencesStore> | undefined;
export function getPreferencesStore() {
  if (!browserStore) {
    let storage: StorageLike | undefined;
    try {
      storage = globalThis.localStorage;
    } catch {
      /* Denied storage. */
    }
    browserStore = createPreferencesStore(
      storage,
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
  }
  return browserStore;
}
