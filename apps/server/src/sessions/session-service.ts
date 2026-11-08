import { randomUUID } from 'node:crypto';
import type { GuestResponse, ResumeResponse } from '@orbit/protocol';
import { PersistenceError } from '../persistence/errors.js';
import { createResumeToken, hashResumeToken, InvalidResumeToken } from './token.js';
import {
  parseAccountResumePayload,
  parseSessionGuestPayload,
  parseSessionResumePayload,
  requestIdOf,
  SessionPayloadError,
} from './input.js';
import { sessionMeta, requestFailure } from './responses.js';
import type { SessionDependencies, SessionService, ControlContext } from './session-types.js';
import type { ConnectionRegistry } from './connection-registry.js';
export const SESSION_TTL_MS = 30 * 86400000;
function clock(now: () => number): number {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('SESSION_CLOCK_INVALID');
  return value;
}
export function createSessionService(
  deps: SessionDependencies,
  registry: ConnectionRegistry,
): SessionService {
  const failure = (time: number, raw: unknown, error: unknown) =>
    requestFailure(
      sessionMeta(deps.serverEpoch, time),
      requestIdOf(raw),
      error instanceof SessionPayloadError
        ? 'INVALID_INPUT'
        : error instanceof InvalidResumeToken ||
            (error instanceof PersistenceError && error.code === 'PERSISTENCE_SESSION_EXPIRED')
          ? 'SESSION_EXPIRED'
          : error instanceof PersistenceError && error.code === 'PERSISTENCE_CONFLICT'
            ? 'SESSION_TAKEN_OVER'
            : 'PERSISTENCE_UNAVAILABLE',
      error instanceof SessionPayloadError ? error.fieldIssues : [],
    );
  function validCredential(context: ControlContext, now: number): boolean {
    return context.accountLoginHash
      ? deps.accounts?.login(context.accountLoginHash, now)?.session_id === context.sessionId
      : !deps.accounts?.emailForSession(context.sessionId);
  }
  async function recover(
    socketId: string,
    input: unknown,
    accountLoginHash?: string,
  ): Promise<ResumeResponse> {
    let now = 0;
    let bound: ControlContext | null = null;
    try {
      now = clock(deps.now);
      const login = accountLoginHash ? deps.accounts?.login(accountLoginHash, now) : undefined;
      const parsed = accountLoginHash
        ? parseAccountResumePayload(input)
        : parseSessionResumePayload(input);
      const session = accountLoginHash
        ? login && deps.repository.findSessionById(login.session_id)
        : 'resumeToken' in parsed && typeof parsed.resumeToken === 'string'
          ? deps.repository.findSessionByTokenHash(hashResumeToken(parsed.resumeToken))
          : null;
      if (
        !session ||
        session.expiresAt <= now ||
        (!accountLoginHash && deps.accounts?.emailForSession(session.sessionId))
      )
        return requestFailure(
          sessionMeta(deps.serverEpoch, now),
          parsed.requestId,
          'SESSION_EXPIRED',
        );
      const updated = deps.repository.incrementSessionGeneration({
          sessionId: session.sessionId,
          expected: session.connectionGeneration,
          now,
        }),
        current: ControlContext = {
          socketId,
          sessionId: session.sessionId,
          connectionGeneration: updated.connectionGeneration,
          ...(accountLoginHash ? { accountLoginHash } : {}),
        },
        previous = registry.bind(current);
      bound = current;
      if (previous && previous.socketId !== socketId) {
        try {
          deps.onTakeover?.(previous, current);
        } catch {
          /* Notification loss cannot undo a committed control transfer. */
        }
      }
      const context = {
        sessionId: session.sessionId,
        roomId: parsed.roomId,
        lastSeenHandId: parsed.lastSeenHandId,
        control: current,
      };
      let resolution = await deps.contextResolver.resolve(context);
      const latest = deps.repository.findSessionById(session.sessionId);
      now = clock(deps.now);
      if (!latest || latest.expiresAt <= now || !validCredential(current, now))
        throw new InvalidResumeToken();
      if (
        !registry.isCurrent(current) ||
        latest.connectionGeneration !== current.connectionGeneration
      )
        throw new PersistenceError('PERSISTENCE_CONFLICT');
      resolution = deps.contextResolver.finalize?.(context, resolution) ?? resolution;
      return Object.freeze({
        ...sessionMeta(deps.serverEpoch, now),
        requestId: parsed.requestId,
        ok: true,
        sessionId: session.sessionId,
        expiresAt: login?.expires_at ?? session.expiresAt,
        connectionGeneration: updated.connectionGeneration,
        ...resolution,
      });
    } catch (error) {
      if (bound && registry.isCurrent(bound)) registry.release(bound);
      return failure(now, input, error);
    }
  }
  return {
    guest(socketId, input): GuestResponse {
      let now = 0;
      try {
        now = clock(deps.now);
        const parsed = parseSessionGuestPayload(input);
        if (registry.getBySocket(socketId))
          return requestFailure(
            sessionMeta(deps.serverEpoch, now),
            parsed.requestId,
            'INVALID_INPUT',
          );
        const expiresAt = now + SESSION_TTL_MS;
        if (!Number.isSafeInteger(expiresAt)) throw new Error('SESSION_CLOCK_INVALID');
        for (let attempt = 0; attempt < 3; attempt++) {
          const sessionId = randomUUID(),
            resumeToken = createResumeToken(),
            tokenHash = hashResumeToken(resumeToken);
          try {
            deps.repository.insertSession({
              sessionId,
              tokenHash,
              nickname: parsed.nickname,
              createdAt: now,
              expiresAt,
              connectionGeneration: 1,
            });
          } catch (error) {
            if (error instanceof PersistenceError && error.code === 'PERSISTENCE_CONFLICT') {
              if (attempt < 2) continue;
              throw new PersistenceError('PERSISTENCE_UNAVAILABLE', error.sqliteErrCode);
            }
            throw error;
          }
          registry.bind({ socketId, sessionId, connectionGeneration: 1 });
          return Object.freeze({
            ...sessionMeta(deps.serverEpoch, now),
            requestId: parsed.requestId,
            ok: true,
            sessionId,
            resumeToken,
            expiresAt,
            connectionGeneration: 1,
          });
        }
        throw new Error('SESSION_ISSUANCE_FAILED');
      } catch (error) {
        return failure(now, input, error);
      }
    },
    resume: (socketId, input) => recover(socketId, input),
    resumeAccount: (socketId, input, loginHash) => recover(socketId, input, loginHash),
    checkController(context) {
      const now = clock(deps.now),
        session = deps.repository.findSessionById(context.sessionId);
      if (!session || session.expiresAt <= now || !validCredential(context, now))
        return Object.freeze({ ok: false, reason: 'SESSION_EXPIRED' });
      if (
        session.connectionGeneration !== context.connectionGeneration ||
        !registry.isCurrent(context)
      )
        return Object.freeze({ ok: false, reason: 'SESSION_TAKEN_OVER' });
      return Object.freeze({ ok: true, context });
    },
    disconnect(context) {
      registry.release(context);
    },
  };
}
