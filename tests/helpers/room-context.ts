import { randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { CommandAck, MutatingCommandMap, MutatingEventName } from '@orbit/protocol';
import {
  createApplicationRuntime,
  type ApplicationOptions,
} from '../../apps/server/src/application-runtime.js';
import { createPokerServer } from '../../apps/server/src/create-server.js';
import { persistenceContext } from './persistence-context.js';
import { request } from './session-context.js';
export async function roomContext(
  options: Omit<ApplicationOptions, 'database' | 'databasePath' | 'now' | 'serverEpoch'> = {},
) {
  const storage = persistenceContext(),
    clock = { now: 1000 },
    app = createApplicationRuntime({
      database: storage.db,
      now: options.serverClock?.now ?? (() => clock.now),
      serverEpoch: 'room-boot',
      ...options,
    });
  const high = { connection: 1000, session: 1000, ip: 10000, windowMs: 1000 };
  const server = createPokerServer({
    port: 0,
    application: app,
    transport: {
      now: options.serverClock?.now ?? (() => clock.now),
      limits: { admission: high, action: high, management: high, global: high },
    },
  });
  const { origin } = await server.listen(),
    clients: Socket[] = [];
  const command = <K extends MutatingEventName>(
    s: Socket,
    event: K,
    payload: MutatingCommandMap[K],
  ): Promise<CommandAck> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        s.off('command:ack', receive);
        reject(new Error('ACK_TIMEOUT'));
      }, 4000);
      const receive = (ack: CommandAck) => {
        if (ack.commandId !== payload.commandId) return;
        clearTimeout(timer);
        s.off('command:ack', receive);
        resolve(ack);
      };
      s.on('command:ack', receive);
      s.emit(event, payload);
    });
  return {
    storage,
    clock,
    app,
    origin,
    command,
    async guest(nickname = 'A') {
      const socket = io(origin, { transports: ['websocket'], reconnection: false, forceNew: true });
      clients.push(socket);
      await new Promise<void>((r, j) => {
        socket.once('connect', r);
        socket.once('connect_error', j);
      });
      const identity = await request(socket, 'session:guest', {
        requestId: randomUUID(),
        nickname,
      });
      if (!identity.ok) throw new Error(identity.code);
      return { socket, ...identity };
    },
    async burst<K extends MutatingEventName>(
      s: Socket,
      event: K,
      payload: MutatingCommandMap[K],
      count: number,
    ): Promise<CommandAck[]> {
      return new Promise((resolve, reject) => {
        const list: CommandAck[] = [];
        const timer = setTimeout(() => {
          s.off('command:ack', receive);
          reject(new Error('BURST_TIMEOUT'));
        }, 4000);
        const receive = (a: CommandAck) => {
          if (a.commandId !== payload.commandId) return;
          list.push(a);
          if (list.length === count) {
            clearTimeout(timer);
            s.off('command:ack', receive);
            resolve(list);
          }
        };
        s.on('command:ack', receive);
        for (let i = 0; i < count; i++) s.emit(event, payload);
      });
    },
    readRoom(id: string) {
      const r = app.rooms.store.get(id);
      if (!r) throw new Error('ROOM_MISSING');
      return r;
    },
    async close() {
      clients.forEach((s) => s.disconnect());
      await server.close();
      await app.close();
      storage.close();
    },
  };
}
