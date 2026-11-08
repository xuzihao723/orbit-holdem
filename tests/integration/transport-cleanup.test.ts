import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { registerCommandRouter } from '../../apps/server/src/transport/command-router.js';
import { registerSessionHandlers } from '../../apps/server/src/transport/session-handlers.js';
import { createSessionRuntime } from '../../apps/server/src/sessions/runtime.js';
import { persistenceContext } from '../helpers/persistence-context.js';
import { request } from '../helpers/session-context.js';
import { randomUUID } from 'node:crypto';
it('detaches only owned connection and socket listeners and releases borrowed control on disposal', async () => {
  const storage = persistenceContext(),
    runtime = createSessionRuntime({ databasePath: storage.path }),
    http = createServer(),
    io = new Server(http);
  const router = registerCommandRouter(io, runtime),
    dispose = registerSessionHandlers(io, runtime, router.beforeIdentity);
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('ADDRESS');
  const serverSocket = new Promise<import('socket.io').Socket>((r) => io.once('connection', r));
  const client = connect('http://127.0.0.1:' + address.port, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
  try {
    const socket = await serverSocket;
    await new Promise<void>((r, j) => {
      if (client.connected) r();
      else {
        client.once('connect', r);
        client.once('connect_error', j);
      }
    });
    const g = await request(client, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
    expect(g.ok).toBe(true);
    expect(socket.listeners('session:guest')).toHaveLength(1);
    expect(socket.listenersAny()).toHaveLength(1);
    dispose();
    router.close();
    dispose();
    router.close();
    expect(socket.listeners('session:guest')).toHaveLength(0);
    expect(socket.listeners('session:resume')).toHaveLength(0);
    expect(socket.listenersAny()).toHaveLength(0);
    expect(io.listeners('connection')).toHaveLength(0);
    expect(runtime.registry.getBySocket(socket.id)).toBeNull();
    expect(storage.db.repositories.findSessionById(g.ok ? g.sessionId : '')).not.toBeNull();
  } finally {
    client.disconnect();
    dispose();
    router.close();
    await io.close();
    runtime.close();
    storage.close();
  }
});
