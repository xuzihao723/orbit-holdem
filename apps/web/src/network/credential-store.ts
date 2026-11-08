export interface Credential {
  sessionId: string;
  resumeToken: string;
  expiresAt: number;
}
export interface CredentialStore {
  read(): Credential | null;
  write(value: Credential): void;
  clear(): void;
}
export function memoryCredentialStore(): CredentialStore {
  let current: Credential | null = null;
  return {
    read: () => (current ? { ...current } : null),
    write: (v) => {
      current = { ...v };
    },
    clear: () => {
      current = null;
    },
  };
}
export function browserCredentialStore(
  storage: Storage = localStorage,
  key = 'orbit.credentials',
): CredentialStore {
  return {
    read() {
      try {
        const raw: unknown = JSON.parse(storage.getItem(key) ?? 'null');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const v = raw as Record<string, unknown>;
        if (
          Object.keys(v).sort().join(',') !== 'expiresAt,resumeToken,sessionId' ||
          typeof v.sessionId !== 'string' ||
          typeof v.resumeToken !== 'string' ||
          !Number.isSafeInteger(v.expiresAt) ||
          Number(v.expiresAt) < 0
        )
          return null;
        return {
          sessionId: v.sessionId,
          resumeToken: v.resumeToken,
          expiresAt: Number(v.expiresAt),
        };
      } catch {
        return null;
      }
    },
    write(v) {
      storage.setItem(key, JSON.stringify(v));
    },
    clear() {
      storage.removeItem(key);
    },
  };
}
