import examples from '../../docs/examples/protocol.json';
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createPokerServer } from '../../apps/server/src/create-server.js';
import { parseMutating } from '../../apps/server/src/transport/command-payloads.js';
import { parseQuery } from '../../apps/server/src/transport/query-payloads.js';
import { transportContext, command } from '../helpers/transport-context.js';
import { resumeRequest, request } from '../helpers/session-context.js';
const id = () => randomUUID(),
  contexts: Awaited<ReturnType<typeof transportContext>>[] = [];
async function context(...args: Parameters<typeof transportContext>) {
  const c = await transportContext(...args);
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

it('allows the configured guest web origin without accepting arbitrary origins', async () => {
  const webOrigin = 'https://cards.example',
    guestWebOrigin = 'https://cards-guest.example',
    server = createPokerServer({ port: 0, webOrigin, guestWebOrigin });
  try {
    const { origin } = await server.listen();
    const connects = async (browserOrigin: string) => {
      const socket = io(origin, {
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
        extraHeaders: { Origin: browserOrigin },
      });
      try {
        return await new Promise<boolean>((resolve) => {
          socket.once('connect', () => resolve(true));
          socket.once('connect_error', () => resolve(false));
        });
      } finally {
        socket.disconnect();
      }
    };
    expect(await connects(webOrigin)).toBe(true);
    expect(await connects(guestWebOrigin)).toBe(true);
    expect(await connects('https://cards-guest.example.invalid')).toBe(false);
  } finally {
    await server.close();
  }
});
it('decodes all eleven mutations and both query shapes without keeping input aliases', () => {
  const versioned = { commandId: id(), roomId: 'r1', expectedRoomVersion: 0 };
  const values = {
    'room:create': { commandId: id(), capacity: 2, nickname: ' A ' },
    'room:join': { commandId: id(), roomCode: ' abc234 ', nickname: 'A' },
    'room:ready': { ...versioned, ready: true },
    'room:capacity:set': { ...versioned, capacity: 3 },
    'room:bot:add': { ...versioned, seatId: 3, difficulty: 'standard' },
    'room:bot:remove': { ...versioned, seatId: 3 },
    'room:start': versioned,
    'room:leave': { commandId: id(), roomId: 'r1' },
    'room:reset:propose': versioned,
    'room:reset:cancel': versioned,
    'game:action': {
      commandId: id(),
      roomId: 'r1',
      handId: 'h',
      turnId: 'h:turn:1',
      expectedVersion: 1,
      action: { type: 'raise', raiseTo: 40 },
    },
  };
  for (const [event, value] of Object.entries(values)) {
    const r = parseMutating(event, value);
    expect(r).not.toBe(value);
    expect(Object.isFrozen(r)).toBe(true);
  }
  expect(parseMutating('room:join', values['room:join'])).toMatchObject({ roomCode: 'ABC234' });
  expect(parseQuery('history:list', { requestId: id(), cursor: null })).toMatchObject({
    limit: 20,
  });
  expect(parseQuery('replay:get', { requestId: id(), handId: 'h' })).toMatchObject({ handId: 'h' });
});
it('rejects unknown fields, getters, binary, malformed identities and illegal amount values', () => {
  const base = { commandId: id(), roomId: 'r', handId: 'h', turnId: 't', expectedVersion: 1 };
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '40']) {
    expect(() =>
      parseMutating('game:action', { ...base, action: { type: 'raise', raiseTo: amount } }),
    ).toThrow('ILLEGAL_AMOUNT');
  }
  for (const type of ['fold', 'check', 'call', 'allIn'])
    expect(() =>
      parseMutating('game:action', { ...base, action: { type, raiseTo: 40 } }),
    ).toThrow();
  expect(() =>
    parseMutating('room:create', { commandId: id(), capacity: 2, nickname: '🙂'.repeat(13) }),
  ).toThrow();
  expect(() =>
    parseMutating('room:create', {
      commandId: id(),
      capacity: 2,
      nickname: 'A',
      sessionId: 'victim',
    }),
  ).toThrow();
  expect(() =>
    parseMutating('room:join', { commandId: id(), roomCode: 'ABO234', nickname: 'A' }),
  ).toThrow();
  for (const bad of [
    null,
    [],
    Buffer.from('x'),
    Object.create({ commandId: id() }),
    {
      get commandId() {
        throw new Error('getter');
      },
    },
  ])
    expect(() => parseMutating('room:start', bad)).toThrow();
  expect(() => parseQuery('history:list', { requestId: id(), cursor: null, limit: 51 })).toThrow();
});
it('privately rejects unauthenticated and malformed commands without invoking an executor', async () => {
  let calls = 0;
  const c = await context({
      async execute() {
        calls++;
        throw new Error('SECRET');
      },
    }),
    a = await c.connect(),
    b = await c.connect(),
    seen: unknown[] = [];
  b.onAny((...args) => seen.push(args));
  const r = await command(a, 'room:create', { commandId: id(), capacity: 2, nickname: 'A' });
  expect(r).toMatchObject({ ok: false, code: 'SESSION_EXPIRED', roomId: null, handId: null });
  await c.guest(a);
  const bad = await command(a, 'game:action', {
    commandId: id(),
    roomId: 'victim',
    sessionId: 'victim',
  });
  expect(bad).toMatchObject({
    ok: false,
    code: 'INVALID_INPUT',
    roomId: null,
    latestHandVersion: null,
  });
  expect(calls).toBe(0);
  expect(seen).toEqual([]);
  expect(await command(a, 'unknown:command', { commandId: id() })).toMatchObject({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it('uses trusted identity and receipt-free rate limiting shared across control generations', async () => {
  let calls = 0;
  const c = await context({
      async execute(x) {
        calls++;
        return {
          protocolVersion: 1,
          serverEpoch: 'transport',
          serverTime: 1000,
          commandId: x.payload.commandId,
          ok: false,
          duplicate: false,
          code: 'NOT_READY',
          retryable: false,
          retryAfterMs: null,
          fieldIssues: [],
          roomId: null,
          handId: null,
          latestRoomVersion: null,
          latestHandVersion: null,
        };
      },
    }),
    a = await c.connect(),
    b = await c.connect();
  const issued = await c.guest(a);
  if (!issued.ok) throw new Error(issued.code);
  const payload = {
    commandId: id(),
    roomId: 'r',
    handId: 'h',
    turnId: 't',
    expectedVersion: 1,
    action: { type: 'check' },
  };
  for (let i = 0; i < 10; i++)
    expect(await command(a, 'game:action', payload)).toMatchObject({ code: 'NOT_READY' });
  expect(await command(a, 'game:action', payload)).toMatchObject({
    code: 'RATE_LIMITED',
    retryable: true,
    retryAfterMs: 1000,
  });
  await request(b, 'session:resume', resumeRequest(issued.resumeToken));
  expect(await command(b, 'game:action', payload)).toMatchObject({ code: 'RATE_LIMITED' });
  c.clock.now += 1000;
  expect(await command(b, 'game:action', payload)).toMatchObject({ code: 'NOT_READY' });
  expect(await command(a, 'game:action', payload)).toMatchObject({ code: 'SESSION_TAKEN_OVER' });
  expect(calls).toBe(11);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM command_receipts').get()?.n).toBe(0);
});
it('shares create/join limits, exposes only safe failures and disconnects oversized transport packets', async () => {
  const c = await context({
      async execute() {
        throw new Error('SECRET_SQL_BINDINGS');
      },
    }),
    a = await c.connect();
  await c.guest(a);
  const p = { commandId: id(), capacity: 2, nickname: 'A' };
  for (let i = 0; i < 5; i++) {
    const r = await command(a, 'room:create', p);
    expect(r).toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toContain('SECRET');
  }
  expect(
    await command(a, 'room:join', { commandId: id(), roomCode: 'ABC234', nickname: 'A' }),
  ).toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 60000 });
  c.clock.now += 60000;
  expect(await command(a, 'room:create', p)).toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  const disconnect = new Promise<void>((r) => a.once('disconnect', () => r()));
  a.emit('unknown:big', { value: 'X'.repeat(20 * 1024) });
  await disconnect;
});

it('keeps malformed and rate-limited query errors on their private request channel', async () => {
  const c = await context(undefined, {
      limits: { global: { connection: 2, session: 0, ip: 20, windowMs: 1000 } },
    }),
    a = await c.connect();
  const reqId = id();
  const send = (payload: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => a.emit('history:list', payload, resolve));
  expect(await send({ requestId: reqId, cursor: null, limit: 51 })).toMatchObject({
    requestId: reqId,
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(await send({ requestId: reqId, cursor: null })).toMatchObject({
    requestId: reqId,
    ok: false,
    code: 'SESSION_EXPIRED',
  });
  expect(await send({ requestId: reqId, cursor: null })).toMatchObject({
    requestId: reqId,
    ok: false,
    code: 'RATE_LIMITED',
    retryAfterMs: 1000,
  });
});
it('applies IP fallback across sessions and bounds unauthenticated identity attempts', async () => {
  const c = await context(undefined, {
      limits: { identity: { connection: 2, session: 0, ip: 3, windowMs: 60000 } },
    }),
    a = await c.connect(),
    b = await c.connect(),
    d = await c.connect();
  expect((await c.guest(a)).ok).toBe(true);
  expect((await c.guest(b)).ok).toBe(true);
  expect((await c.guest(d)).ok).toBe(true);
  expect(await c.guest(a)).toMatchObject({ ok: false, code: 'RATE_LIMITED', retryAfterMs: 60000 });
  c.clock.now += 60000;
  expect(await c.guest(a)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM sessions').get()?.n).toBe(3);
});

it('rejects extra identity arguments and still accounts them in global limits', async () => {
  const c = await context(undefined, {
      limits: { global: { connection: 2, session: 0, ip: 20, windowMs: 1000 } },
    }),
    a = await c.connect();
  const p = { requestId: id(), nickname: 'A' };
  const malformed = () =>
    new Promise<unknown>((resolve, reject) =>
      a
        .timeout(500)
        .emit('session:guest', p, 'extra', (e: Error | null, r: unknown) =>
          e ? reject(e) : resolve(r),
        ),
    );
  expect(await malformed()).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  expect(await malformed()).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  expect(await c.guest(a)).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM sessions').get()?.n).toBe(0);
});

it('decodes the frozen W02 successful mutating requests without changing their meaning', () => {
  let count = 0;
  for (const example of examples) {
    if (example.response.ok && 'commandId' in example.request) {
      expect(parseMutating(example.event, example.request)).toEqual(example.request);
      count++;
    }
  }
  expect(count).toBe(4);
});

it('never emits a contradictory failure when a post-commit publisher fails', async () => {
  const c = await context({
      async execute(x) {
        return {
          protocolVersion: 1,
          serverEpoch: 'transport',
          serverTime: 1000,
          commandId: x.payload.commandId,
          ok: true,
          duplicate: false,
          roomId: 'r',
          appliedRoomVersion: 1,
          handId: null,
          appliedHandVersion: null,
        };
      },
      afterAck() {
        throw new Error('notify failed');
      },
    }),
    a = await c.connect();
  await c.guest(a);
  const seen: unknown[] = [];
  a.on('command:ack', (x) => seen.push(x));
  expect(
    await command(a, 'room:create', { commandId: id(), capacity: 2, nickname: 'A' }),
  ).toMatchObject({ ok: true });
  await new Promise<void>((r) => setTimeout(r, 20));
  expect(seen).toHaveLength(1);
});
