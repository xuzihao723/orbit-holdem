import type { PokerDatabase } from '../persistence/rows.js';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../persistence/db.js';
import { createSessionService } from './session-service.js';
import { ConnectionRegistry } from './connection-registry.js';
import { defaultResumeContext } from './resume-context.js';
import { sessionMeta } from './responses.js';
import type { ControlContext, ResumeContextResolver, SessionRuntime } from './session-types.js';
export function createSessionRuntime(
  input: (
    | { readonly databasePath: string; readonly database?: never }
    | { readonly database: PokerDatabase; readonly databasePath?: never }
  ) & {
    readonly now?: () => number;
    readonly serverEpoch?: string;
    readonly contextResolver?: ResumeContextResolver;
    readonly canAccessSeat?: (roomId: string, participantId: string) => boolean;
  },
): SessionRuntime {
  const owned = input.database === undefined,
    db = input.database ?? openDatabase({ path: input.databasePath!, busyTimeoutMs: 1000 });
  try {
    db.migrate();
    const registry = new ConnectionRegistry(),
      now = input.now ?? Date.now,
      serverEpoch = input.serverEpoch ?? randomUUID(),
      listeners = new Set<(previous: ControlContext, current: ControlContext) => void>();
    if (!serverEpoch.trim()) throw new Error('INVALID_SERVER_EPOCH');
    const service = createSessionService(
      {
        repository: db.repositories,
        accounts: db.accounts,
        now,
        serverEpoch,
        contextResolver: input.contextResolver ?? defaultResumeContext(db.repositories),
        onTakeover(previous, current) {
          for (const listener of listeners) {
            try {
              listener(previous, current);
            } catch {
              /* A dropped status notification does not restore stale authority. */
            }
          }
        },
      },
      registry,
    );
    let closed = false;
    return Object.freeze({
      canAccessSeat: input.canAccessSeat ?? (() => true),
      service,
      registry,
      serverEpoch,
      meta() {
        let time = 0;
        try {
          time = now();
        } catch {
          /* Internal clock errors produce a safe failure envelope. */
        }
        return sessionMeta(serverEpoch, time);
      },
      onTakeover(listener: (previous: ControlContext, current: ControlContext) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close() {
        if (closed) return;
        closed = true;
        listeners.clear();
        registry.clear();
        if (owned) db.close();
      },
    });
  } catch (error) {
    if (owned) db.close();
    throw error;
  }
}
