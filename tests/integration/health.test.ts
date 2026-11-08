import { afterEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createPokerServer } from '../../apps/server/src/create-server.js';

const servers: Array<ReturnType<typeof createPokerServer>> = [];
const clients: Socket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function create(port = 0) {
  const server = createPokerServer({ host: '127.0.0.1', port });
  servers.push(server);
  return server;
}

it('serves a real HTTP liveness response without claiming database readiness', async () => {
  const address = await create().listen();
  const response = await fetch(`${address.origin}/health/live`);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ status: 'ok' });
});

it('returns 404 for an unregistered route', async () => {
  const address = await create().listen();
  const response = await fetch(`${address.origin}/unknown`);
  expect(response.status).toBe(404);
});

it('connects and disconnects an actual Socket.IO transport without issuing credentials', async () => {
  const address = await create().listen();
  const client = io(address.origin, {
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
  });
  clients.push(client);
  const applicationEvents: string[] = [];
  client.onAny((event: string) => applicationEvents.push(event));
  await new Promise<void>((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('connect_error', reject);
    client.connect();
  });
  expect(client.connected).toBe(true);
  expect(applicationEvents).toEqual([]);
  client.disconnect();
  expect(client.connected).toBe(false);
});

it('closes idempotently and releases its port', async () => {
  const first = create();
  const address = await first.listen();
  await first.close();
  await first.close();
  const secondAddress = await create(address.port).listen();
  expect(secondAddress.port).toBe(address.port);
});

it('accepts the configured browser origin on a WebSocket handshake', async () => {
  const address = await create().listen();
  const client = io(address.origin, {
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    extraHeaders: { Origin: 'http://127.0.0.1:5173' },
  });
  clients.push(client);
  const outcome = await new Promise<string>((resolve) => {
    client.once('connect', () => resolve('accepted'));
    client.once('connect_error', () => resolve('rejected'));
    client.connect();
  });
  expect(outcome).toBe('accepted');
});

it('rejects a different browser origin even for WebSocket-only clients', async () => {
  const address = await create().listen();
  const client = io(address.origin, {
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
    extraHeaders: { Origin: 'http://untrusted.example' },
  });
  clients.push(client);
  const outcome = await new Promise<string>((resolve) => {
    client.once('connect', () => resolve('accepted'));
    client.once('connect_error', () => resolve('rejected'));
    client.connect();
  });
  expect(outcome).toBe('rejected');
});

it('rejects an occupied port without silently selecting a different one', async () => {
  const firstAddress = await create().listen();
  await expect(create(firstAddress.port).listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  expect((await fetch(`${firstAddress.origin}/health/live`)).status).toBe(200);
});
