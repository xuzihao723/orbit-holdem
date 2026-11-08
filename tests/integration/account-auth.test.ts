import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { expect, it } from 'vitest';
import { createApplicationRuntime } from '../../apps/server/src/application-runtime.js';
import { createPokerServer } from '../../apps/server/src/create-server.js';
import { command } from '../helpers/transport-context.js';
import { authClientAddress } from '../../apps/server/src/http/auth-handler.js';

it('trusts an upstream client address only with the configured ingress key', () => {
  const key = 'a'.repeat(64);
  expect(authClientAddress('172.17.0.2', '203.0.113.7', key, key)).toBe('203.0.113.7');
  expect(authClientAddress('172.17.0.2', '203.0.113.7', 'b'.repeat(64), key)).toBe('172.17.0.2');
  expect(authClientAddress('172.17.0.2', '203.0.113.7, 198.51.100.4', key, key)).toBe('172.17.0.2');
  expect(authClientAddress('::ffff:127.0.0.1', '203.0.113.7', undefined, undefined)).toBe(
    '127.0.0.1',
  );
});

it('verifies email, upgrades the same guest, and revokes sessions on password reset', async () => {
  let now = Date.now();
  const outbox: { email: string; code: string }[] = [];
  const app = createApplicationRuntime({ databasePath: ':memory:', now: () => now });
  const webOrigin = 'http://127.0.0.1:5173';
  const server = createPokerServer({
    application: app,
    port: 0,
    webOrigin,
    accounts: {
      codeKey: Buffer.alloc(32, 17),
      deliver: async (message) => {
        outbox.push(message);
      },
    },
  });
  const { origin } = await server.listen();
  const sockets: ReturnType<typeof io>[] = [];
  const cookies = new Map<string, string>();
  const cookie = () => [...cookies.values()].join('; ');
  async function call(path: string, data?: object, from = webOrigin) {
    const res = await fetch(origin + '/api/auth/' + path, {
      method: data ? 'POST' : 'GET',
      headers: { origin: from, cookie: cookie(), 'content-type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    for (const value of res.headers.getSetCookie()) {
      const pair = value.split(';')[0]!;
      cookies.set(pair.split('=')[0]!, pair);
    }
    return { status: res.status, body: await res.json() };
  }
  async function connection(header = cookie()) {
    const socket = io(origin, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { Origin: webOrigin, Cookie: header },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }
  const location = {
    roomId: null,
    lastSeenHandId: null,
    lastSeenRoomVersion: null,
    lastSeenHandVersion: null,
  };
  try {
    const guestSocket = await connection('');
    const guest = await guestSocket
      .timeout(1500)
      .emitWithAck('session:guest', { requestId: randomUUID(), nickname: '游客甲' });
    expect(guest.ok).toBe(true);
    const created = await command(guestSocket, 'room:create', {
      commandId: randomUUID(),
      nickname: '游客甲',
      capacity: 2,
    });
    if (!created.ok) throw Error(created.code);
    const room = () => app.rooms.store.get(created.roomId)!;
    const peer = await connection('');
    expect(
      (
        await peer.timeout(1500).emitWithAck('session:guest', {
          requestId: randomUUID(),
          nickname: '游客乙',
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await command(peer, 'room:join', {
          commandId: randomUUID(),
          roomCode: room().row.roomCode,
          nickname: '游客乙',
        })
      ).ok,
    ).toBe(true);
    for (const socket of [guestSocket, peer])
      expect(
        (
          await command(socket, 'room:ready', {
            commandId: randomUUID(),
            roomId: created.roomId,
            expectedRoomVersion: room().row.roomVersion,
            ready: true,
          })
        ).ok,
      ).toBe(true);
    expect(
      (
        await command(guestSocket, 'room:start', {
          commandId: randomUUID(),
          roomId: created.roomId,
          expectedRoomVersion: room().row.roomVersion,
        })
      ).ok,
    ).toBe(true);
    const email = 'player@outlook.com';
    expect(
      (await call('code/send', { email, purpose: 'register' }, 'https://elsewhere.example')).status,
    ).toBe(403);
    const sent = await call('code/send', { email, purpose: 'register' });
    expect(sent.status).toBe(202);
    expect(sent.body).not.toHaveProperty('code');
    for (let repeat = 0; repeat < 5; repeat++)
      expect((await call('code/send', { email, purpose: 'register' })).status).toBe(429);
    expect(outbox).toHaveLength(1);
    const { challengeId } = sent.body;
    const code = outbox[0]!.code;
    expect(
      (await call('code/verify', { challengeId, code: code === '000000' ? '000001' : '000000' }))
        .status,
    ).toBe(400);
    const verified = await call('code/verify', { challengeId, code });
    expect(verified.status).toBe(200);
    expect((await call('code/send', { email, purpose: 'reset' })).status).toBe(202);
    expect(outbox).toHaveLength(1);
    const password = 'a-long-orbit-passphrase';
    const registration = {
      proof: verified.body.proof,
      password,
      nickname: '游客甲',
      guestToken: guest.resumeToken,
    };
    expect(await call('register', registration)).toMatchObject({
      status: 409,
      body: { error: 'GUEST_HAND_IN_PROGRESS' },
    });
    const hand = room().hand!;
    const actor = hand.betting!.actorSeatId === 0 ? guestSocket : peer;
    expect(
      (
        await command(actor, 'game:action', {
          commandId: randomUUID(),
          roomId: created.roomId,
          handId: hand.handId,
          turnId: hand.turnId,
          expectedVersion: hand.handVersion,
          action: { type: 'fold' },
        })
      ).ok,
    ).toBe(true);
    expect((await call('register', registration)).status).toBe(201);
    expect((await call('me')).body.sessionId).toBe(guest.sessionId);
    const signed = await connection();
    const restored = await signed
      .timeout(1500)
      .emitWithAck('session:account-resume', { requestId: randomUUID(), ...location });
    expect(restored).toMatchObject({ ok: true, sessionId: guest.sessionId });
    expect(
      await signed
        .timeout(1500)
        .emitWithAck('history:list', { requestId: randomUUID(), cursor: null }),
    ).toMatchObject({ ok: true, items: [{ handId: hand.handId, status: 'settled' }] });
    expect((await call('register', registration)).status).toBe(400);
    expect(guestSocket.connected).toBe(false);
    const oldGuest = await (await connection('')).timeout(1500).emitWithAck('session:resume', {
      requestId: randomUUID(),
      ...location,
      resumeToken: guest.resumeToken,
    });
    expect(oldGuest).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' });
    const oldCookies = cookie();
    now += 61_000;
    const reset = await call('code/send', { email, purpose: 'reset' });
    const resetProof = await call('code/verify', {
      challengeId: reset.body.challengeId,
      code: outbox.at(-1)!.code,
    });
    expect(
      (
        await call('reset-password', {
          proof: resetProof.body.proof,
          password: 'another-orbit-passphrase',
        })
      ).status,
    ).toBe(200);
    const oldSocket = await connection(oldCookies);
    expect(
      await oldSocket
        .timeout(1500)
        .emitWithAck('session:account-resume', { requestId: randomUUID(), ...location }),
    ).toMatchObject({ ok: false });
    expect((await call('login', { email, password })).status).toBe(401);
    expect((await call('login', { email, password: 'another-orbit-passphrase' })).status).toBe(200);
    expect((await call('me')).body.sessionId).toBe(guest.sessionId);
    expect((await call('logout', {})).status).toBe(200);
    expect((await call('me')).body.sessionId).toBeNull();
    const expiring = await call('code/send', { email: 'another@example.com', purpose: 'register' });
    expect(expiring.status).toBe(202);
    now += 300_001;
    expect(
      (
        await call('code/verify', {
          challengeId: expiring.body.challengeId,
          code: outbox.at(-1)!.code,
        })
      ).status,
    ).toBe(400);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await server.close();
    await app.close();
  }
});
