import type { RequestFailure, SessionResumed } from '@orbit/protocol';
import type { Server, Socket } from 'socket.io';
import type { SessionRuntime } from '../sessions/session-types.js';
import {
  parseSessionGuestPayload,
  parseSessionResumePayload,
  requestIdOf,
  SessionPayloadError,
} from './session-payloads.js';
import { requestFailure } from '../sessions/responses.js';
import { parseAccountResumePayload } from '../sessions/input.js';
export function registerSessionHandlers(
  io: Server,
  runtime: SessionRuntime,
  before?: (socket: Socket, event: string, raw: unknown) => RequestFailure | null,
  afterResume?: (socketId: string, response: SessionResumed) => void,
  accountLogin?: (socket: Socket) => string | null,
): () => void {
  const remove = runtime.onTakeover((previous, current) =>
    io.sockets.sockets.get(previous.socketId)?.emit('session:status', {
      ...runtime.meta(),
      status: 'takenOver',
      connectionGeneration: current.connectionGeneration,
    }),
  );
  const cleanup = new Map<Socket, () => void>();
  const onConnection = (socket: Socket) => {
    const handle =
      (event: 'session:guest' | 'session:resume' | 'session:account-resume') =>
      async (...args: unknown[]) => {
        const payload = args[0],
          ack = args[args.length - 1];
        const failure = before?.(socket, event, payload);
        if (typeof ack !== 'function') return;
        if (failure) {
          ack(failure);
          return;
        }
        if (args.length !== 2) {
          ack(requestFailure(runtime.meta(), requestIdOf(payload), 'INVALID_INPUT'));
          return;
        }
        try {
          const login = event === 'session:account-resume' ? accountLogin?.(socket) : null;
          const result =
            event === 'session:guest'
              ? runtime.service.guest(socket.id, parseSessionGuestPayload(payload))
              : event === 'session:resume'
                ? await runtime.service.resume(socket.id, parseSessionResumePayload(payload))
                : login
                  ? await runtime.service.resumeAccount(
                      socket.id,
                      parseAccountResumePayload(payload),
                      login,
                    )
                  : requestFailure(runtime.meta(), requestIdOf(payload), 'SESSION_EXPIRED');
          ack(result);
          if (event !== 'session:guest' && result.ok && 'outcome' in result)
            try {
              afterResume?.(socket.id, result);
            } catch {
              /* Notification failure cannot issue a second identity response. */
            }
        } catch (error) {
          ack(
            requestFailure(
              runtime.meta(),
              requestIdOf(payload),
              error instanceof SessionPayloadError ? 'INVALID_INPUT' : 'PERSISTENCE_UNAVAILABLE',
              error instanceof SessionPayloadError ? error.fieldIssues : [],
            ),
          );
        }
      };
    const guest = handle('session:guest'),
      resume = handle('session:resume'),
      account = handle('session:account-resume');
    const release = () => {
      const context = runtime.registry.getBySocket(socket.id);
      if (context) runtime.service.disconnect(context);
    };
    const disconnect = () => {
      release();
      cleanup.get(socket)?.();
      cleanup.delete(socket);
    };
    cleanup.set(socket, () => {
      socket.off('session:guest', guest);
      socket.off('session:resume', resume);
      socket.off('session:account-resume', account);
      socket.off('disconnect', disconnect);
    });
    socket.on('session:guest', guest);
    socket.on('session:resume', resume);
    socket.on('session:account-resume', account);
    socket.on('disconnect', disconnect);
  };
  io.on('connection', onConnection);
  return () => {
    remove();
    io.off('connection', onConnection);
    for (const [socket, dispose] of cleanup) {
      const c = runtime.registry.getBySocket(socket.id);
      if (c) runtime.service.disconnect(c);
      dispose();
    }
    cleanup.clear();
  };
}
