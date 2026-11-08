import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type { CommandAck } from '@orbit/protocol';
import { createPokerServer } from '../../apps/server/src/create-server.js';
import { createSessionRuntime } from '../../apps/server/src/sessions/runtime.js';
import { persistenceContext } from './persistence-context.js';
import { request } from './session-context.js';
import type { CommandExecutor, TransportOptions } from '../../apps/server/src/transport/types.js';
export async function transportContext(executor?: CommandExecutor, options: TransportOptions = {}) {
  const storage = persistenceContext(),
    clock = { now: 1000 },
    runtime = createSessionRuntime({
      databasePath: storage.path,
      now: () => clock.now,
      serverEpoch: 'transport',
    });
  const server = createPokerServer({
    port: 0,
    sessions: runtime,
    ...(executor ? { executor } : {}),
    transport: { now: () => clock.now, ...options },
  });
  const { origin } = await server.listen();
  const clients: Socket[] = [];
  return {
    storage,
    clock,
    runtime,
    async connect() {
      const s = io(origin, { transports: ['websocket'], reconnection: false, forceNew: true });
      clients.push(s);
      await new Promise<void>((r, j) => {
        s.once('connect', r);
        s.once('connect_error', j);
      });
      return s;
    },
    async guest(s: Socket) {
      return request(s, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
    },
    async close() {
      clients.forEach((s) => s.disconnect());
      await server.close();
      runtime.close();
      storage.close();
    },
  };
}
export function command(s: Socket, event: string, payload: unknown): Promise<CommandAck> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      s.off('command:ack', onAck);
      reject(new Error('ACK_TIMEOUT'));
    }, 1000);
    const onAck = (a: CommandAck) => {
      clearTimeout(timeout);
      s.off('command:ack', onAck);
      resolve(a);
    };
    s.on('command:ack', onAck);
    s.emit(event, payload);
  });
}
