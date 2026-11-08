interface AccountState {
  enabled: boolean;
  googleEnabled: boolean;
  emailEnabled: boolean;
  sessionId: string | null;
  email: string | null;
  nickname: string | null;
}
export async function accountRequest<T>(path: string, body: object): Promise<T> {
  const response = await fetch('/api/auth/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw Error(typeof result.error === 'string' ? result.error : 'AUTH_UNAVAILABLE');
  return result as T;
}
export function createAccountState() {
  const listeners = new Set<() => void>();
  let state: AccountState = {
    enabled: false,
    googleEnabled: false,
    emailEnabled: false,
    sessionId: null,
    email: null,
    nickname: null,
  };
  let loading: Promise<void> | undefined;
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load() {
      return (loading ??= fetch('/api/auth/me')
        .then(async (response) => {
          if (!response.ok) return;
          const value = await response.json();
          state = {
            enabled: value.enabled === true,
            googleEnabled: value.googleEnabled === true,
            emailEnabled: value.emailEnabled === true,
            sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
            email: typeof value.email === 'string' ? value.email : null,
            nickname: typeof value.nickname === 'string' ? value.nickname : null,
          };
          for (const listener of listeners) listener();
        })
        .catch(() => {}));
    },
  };
}
