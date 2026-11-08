import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { createSocketClient } from '../network/socket-client';
import { ResumeCoordinator } from '../network/resume-session';
import { browserEntryIntentStore } from '../features/room/entry-intent-store';
import { RouterStore } from './router';
import { createAccountState } from '../network/account-client';
export function createNetworkRuntime() {
  const gameOrigin = import.meta.env.VITE_ORBIT_SOCKET_ORIGIN as string | undefined;
  const account = createAccountState(Boolean(gameOrigin)),
    client = createSocketClient({ account, ...(gameOrigin ? { url: gameOrigin } : {}) }),
    recovery = new ResumeCoordinator(client),
    router = new RouterStore(),
    intents = browserEntryIntentStore(localStorage, () => account.snapshot().sessionId);
  return {
    client,
    account,
    recovery,
    router,
    intents,
    close() {
      recovery.close();
      client.close();
    },
  };
}
type Runtime = ReturnType<typeof createNetworkRuntime>;
const Context = createContext<Runtime | null>(null);
export function NetworkProvider({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  useEffect(() => {
    const remove = runtime.client.store.subscribe(() => runtime.recovery.watch());
    const changed = () => runtime.client.invalidateCredentials();
    window.addEventListener('storage', changed);
    let mounted = true;
    void runtime.account.load().then(() => {
      if (mounted && runtime.client.identitySessionId) void runtime.recovery.start();
    });
    return () => {
      mounted = false;
      remove();
      window.removeEventListener('storage', changed);
      runtime.close();
    };
  }, [runtime]);
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}
export function useNetwork() {
  const runtime = useContext(Context);
  if (!runtime) throw Error('NETWORK_PROVIDER_REQUIRED');
  const snapshot = useSyncExternalStore(
    runtime.client.store.subscribe,
    () => runtime.client.store.snapshot,
    () => runtime.client.store.snapshot,
  );
  return { ...runtime, snapshot };
}
export function useAppRoute() {
  const runtime = useContext(Context);
  if (!runtime) throw Error('NETWORK_PROVIDER_REQUIRED');
  return useSyncExternalStore(
    runtime.router.subscribe,
    runtime.router.snapshot,
    runtime.router.snapshot,
  );
}
export function useAccount() {
  const runtime = useContext(Context);
  if (!runtime) throw Error('NETWORK_PROVIDER_REQUIRED');
  return useSyncExternalStore(runtime.account.subscribe, runtime.account.snapshot);
}
