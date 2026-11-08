import { useSyncExternalStore } from 'react';
import { getPreferencesStore } from './preferences-store';
export function usePreferences() {
  const store = getPreferencesStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.snapshot,
    () => store.snapshot,
  );
}
