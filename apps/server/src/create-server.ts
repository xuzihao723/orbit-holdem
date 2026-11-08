import type { ApplicationRuntime } from './application-runtime.js';
import { registerCommandRouter } from './transport/command-router.js';
import type { CommandExecutor, TransportOptions, QueryExecutor } from './transport/types.js';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { registerSessionHandlers } from './transport/session-handlers.js';
import type { SessionRuntime } from './sessions/session-types.js';
import { serveStatic } from './http/static-handler.js';
import type { AuthOptions } from './auth/delivery.js';
import type { GoogleSignIn } from './auth/google.js';
import { accountCookieName, cookieHash } from './auth/session-cookie.js';
import { authClientAddress, createAuthHandler } from './http/auth-handler.js';

export interface ServerOptions {
  host?: string;
  port?: number;
  webOrigin?: string;
  sessions?: SessionRuntime;
  application?: ApplicationRuntime;
  executor?: CommandExecutor;
  queryExecutor?: QueryExecutor;
  webDist?: string;
  healthReady?: () => boolean;
  transport?: TransportOptions;
  accounts?: AuthOptions;
  google?: GoogleSignIn;
}

export interface ListeningAddress {
  origin: string;
  host: string;
  port: number;
}

export function createPokerServer(options: ServerOptions = {}) {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3001;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('PORT must be an integer between 0 and 65535');
  }

  const webOrigin = options.webOrigin ?? 'http://127.0.0.1:5173';
  const sessions = options.sessions ?? options.application?.sessions;
  const proxyKey = options.google?.proxyKey ?? options.accounts?.proxyKey;
  const auth =
    (options.accounts || options.google) &&
    options.application &&
    createAuthHandler(
      options.application,
      options.accounts,
      options.google,
      webOrigin,
      () => options.application!.sessions.meta().serverTime,
      (sessionId) => {
        const control = sessions?.registry.getCurrent(sessionId);
        if (control && !sessions?.service.checkController(control).ok) {
          io.sockets.sockets.get(control.socketId)?.disconnect(true);
          sessions?.registry.release(control);
        }
      },
    );
  let draining = false;
  const http = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const path = request.url?.split('?')[0];
    if (path?.startsWith('/api/auth/')) {
      if (auth && !draining) {
        void auth(request, response, path.slice('/api/auth/'.length));
      } else {
        response.writeHead(
          draining ? 503 : path === '/api/auth/me' && request.method === 'GET' ? 200 : 404,
          {
            'Content-Type': 'application/json; charset=utf-8',
          },
        );
        response.end(JSON.stringify({ enabled: false, sessionId: null }));
      }
      return;
    }
    if (request.method === 'GET' && request.url?.split('?')[0] === '/health/live') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (
      ['GET', 'HEAD'].includes(request.method ?? '') &&
      request.url?.split('?')[0] === '/health/ready'
    ) {
      let ready = false;
      try {
        if (!draining) {
          if (options.healthReady) ready = options.healthReady();
          else if (options.application) {
            options.application.database.repositories.findSessionById('health-check');
            ready = true;
          }
        }
      } catch {
        ready = false;
      }
      response.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(
        request.method === 'HEAD'
          ? undefined
          : JSON.stringify({ status: ready ? 'ready' : 'unavailable' }),
      );
      return;
    }
    if (options.webDist) {
      serveStatic(options.webDist, request, response);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  });
  const io = new Server(http, {
    serveClient: false,
    maxHttpBufferSize: 16 * 1024,
    cors: { origin: webOrigin, methods: ['GET', 'POST'] },
    allowRequest(request, accept) {
      const origin = request.headers.origin;
      // Origin-less native tools remain usable; this is not session authentication.
      accept(null, origin === undefined || origin === webOrigin);
    },
  });

  const executor = options.executor ?? options.application?.rooms;
  const removePublication = options.application?.onPublish((p) =>
    io.sockets.sockets.get(p.socketId)?.emit(p.event, p.payload),
  );
  const router = sessions
    ? registerCommandRouter(
        io,
        sessions,
        executor,
        proxyKey
          ? {
              ...options.transport,
              clientAddress: (request) =>
                authClientAddress(
                  request.socket.remoteAddress,
                  request.headers['x-orbit-client-ip'],
                  request.headers['x-orbit-proxy-key'],
                  proxyKey,
                ),
            }
          : options.transport,
        options.queryExecutor ?? options.application?.history,
      )
    : undefined;
  const removeSessionHandlers = sessions
    ? registerSessionHandlers(
        io,
        sessions,
        router?.beforeIdentity,
        options.application?.afterResume,
        (socket) =>
          auth && socket.handshake.headers.origin === webOrigin
            ? cookieHash(
                socket.handshake.headers.cookie,
                accountCookieName(webOrigin.startsWith('https:')),
              )
            : null,
      )
    : () => {};
  let listening: Promise<ListeningAddress> | undefined;
  let closing: Promise<void> | undefined;
  return {
    listen(): Promise<ListeningAddress> {
      if (closing) return Promise.reject(new Error('Server has already been closed'));
      listening ??= new Promise((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        http.once('error', onError);
        http.listen(port, host, () => {
          http.off('error', onError);
          const address = http.address();
          if (!address || typeof address === 'string') {
            reject(new Error('Server did not receive a TCP address'));
            return;
          }
          const displayHost = host.includes(':') ? `[${host}]` : host;
          resolve({ host, port: address.port, origin: `http://${displayHost}:${address.port}` });
        });
      });
      return listening;
    },
    close(): Promise<void> {
      if (!closing) {
        draining = true;
        removePublication?.();
        removeSessionHandlers();
        router?.close();
        closing = io.close();
      }
      return closing;
    },
  };
}
