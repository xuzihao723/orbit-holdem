import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { io } from 'socket.io-client';
import { expect, it, vi } from 'vitest';
import { googleSignIn } from '../../apps/server/src/auth/google.js';
import { createApplicationRuntime } from '../../apps/server/src/application-runtime.js';
import { createPokerServer } from '../../apps/server/src/create-server.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { persistenceContext, storedSession } from '../helpers/persistence-context.js';

it('accepts only a verified Google ID token for this client and nonce', async () => {
  const clientId = 'test-client.apps.googleusercontent.com';
  const provider = googleSignIn(
    { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: 'test-secret' },
    'http://127.0.0.1:5173',
  )!;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  type Certs = Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>;
  const certs = vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
    certs: { test: publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    format: 'PEM' as Certs['format'],
  });
  const payload = (overrides = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url');
    const claims = {
      iss: 'https://accounts.google.com',
      aud: clientId,
      sub: 'provider-subject',
      nonce: 'expected-nonce',
      email: 'player@gmail.com',
      email_verified: true,
      name: 'Google 玩家',
      iat: now,
      exp: now + 300,
      ...overrides,
    };
    const unsigned = encode({ alg: 'RS256', kid: 'test' }) + '.' + encode(claims);
    return (
      unsigned + '.' + sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')
    );
  };
  let idToken = payload();
  const fetch = vi.fn(async (_url: string, _options?: RequestInit) =>
    Response.json({ id_token: idToken }),
  );
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(provider.identity('code', 'verifier', 'expected-nonce')).resolves.toEqual({
      subject: 'provider-subject',
      email: 'player@gmail.com',
      nickname: 'Google 玩家',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/token');
    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get('code_verifier')).toBe('verifier');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:5173/api/auth/google/callback');
    await expect(provider.identity('code', 'verifier', 'other-nonce')).rejects.toThrow(
      'GOOGLE_IDENTITY_INVALID',
    );
    idToken = payload({ aud: 'other-client' });
    await expect(provider.identity('code', 'verifier', 'expected-nonce')).rejects.toThrow();
    idToken = payload({ email_verified: false });
    await expect(provider.identity('code', 'verifier', 'expected-nonce')).rejects.toThrow(
      'GOOGLE_IDENTITY_INVALID',
    );
  } finally {
    certs.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('uses a browser-bound Google callback once and signs the same account back in', async () => {
  const clock = new FakeClock();
  const app = createApplicationRuntime({ databasePath: ':memory:', serverClock: clock });
  const webOrigin = 'http://127.0.0.1:5173';
  let exchanges = 0;
  let googleEmail = 'player@gmail.com';
  const server = createPokerServer({
    port: 0,
    webOrigin,
    application: app,
    google: {
      authorizationUrl({ state, nonce, challenge }) {
        return (
          'https://accounts.google.com/example?' + new URLSearchParams({ state, nonce, challenge })
        );
      },
      async identity(code, verifier, nonce) {
        exchanges++;
        expect(code).toBe('provider-code');
        expect(verifier).toHaveLength(43);
        expect(nonce).toHaveLength(43);
        return { subject: 'stable-google-id', email: googleEmail, nickname: 'Google 玩家' };
      },
    },
  });
  const { origin } = await server.listen();
  const api = origin + '/api/auth/';
  const start = (next: string, from = webOrigin) =>
    fetch(api + 'google/start?next=' + encodeURIComponent(next), {
      method: 'POST',
      headers: { origin: from },
      redirect: 'manual',
    });
  const callback = (state: string, cookie: string, result = 'code=provider-code') =>
    fetch(api + 'google/callback?state=' + state + '&' + result, {
      headers: { cookie },
      redirect: 'manual',
    });
  const me = async (cookie = '') => (await fetch(api + 'me', { headers: { cookie } })).json();
  const parse = (response: Response) => ({
    flow: response.headers.getSetCookie()[0]!.split(';')[0]!,
    state: new URL(response.headers.get('location')!).searchParams.get('state')!,
  });
  try {
    expect(await me()).toMatchObject({ enabled: true, googleEnabled: true, emailEnabled: false });
    expect((await start('/', 'https://other.example')).status).toBe(403);
    const invitation = '/play?mode=join&room=ABC234';
    const started = await start(invitation);
    expect(started.status).toBe(303);
    const { state, flow } = parse(started);
    expect((await callback(state, 'wrong=browser')).headers.get('location')).toContain(
      'google=failed',
    );
    expect(exchanges).toBe(0);
    const completed = await callback(state, flow);
    expect(completed.headers.get('location')).toBe(invitation);
    const cookie = completed.headers.getSetCookie().find((x) => x.startsWith('orbit-login='))!;
    expect(cookie).toContain('HttpOnly');
    const first = await me(cookie.split(';')[0]);
    expect(first).toMatchObject({ email: 'p***@gmail.com', nickname: 'Google 玩家' });
    expect(first.sessionId).toEqual(expect.any(String));
    const socket = io(origin, {
      transports: ['websocket'],
      extraHeaders: { Origin: webOrigin, Cookie: cookie.split(';')[0]! },
    });
    try {
      const result = await socket.timeout(2000).emitWithAck('session:account-resume', {
        requestId: randomUUID(),
        roomId: null,
        lastSeenHandId: null,
        lastSeenRoomVersion: null,
        lastSeenHandVersion: null,
      });
      expect(result).toMatchObject({ ok: true, sessionId: first.sessionId });
    } finally {
      socket.disconnect();
    }
    expect((await callback(state, flow)).headers.get('location')).toContain('google=failed');
    expect(exchanges).toBe(1);
    const denied = parse(await start(invitation));
    expect(
      (await callback(denied.state, denied.flow, 'error=access_denied')).headers.get('location'),
    ).toContain('google=cancelled');
    expect((await callback(denied.state, denied.flow)).headers.get('location')).toContain(
      'google=failed',
    );
    googleEmail = 'changed@example.com';
    const again = parse(await start('/x/..//external.example'));
    const signedIn = await callback(again.state, again.flow);
    expect(signedIn.headers.get('location')).toBe('/');
    const nextCookie = signedIn.headers.getSetCookie().find((x) => x.startsWith('orbit-login='))!;
    expect(await me(nextCookie.split(';')[0])).toMatchObject({
      sessionId: first.sessionId,
      email: 'c***@example.com',
    });
    const expired = parse(await start(invitation));
    await clock.advanceTo(300_001);
    expect((await callback(expired.state, expired.flow)).headers.get('location')).toContain(
      'google=failed',
    );
    expect(exchanges).toBe(2);
  } finally {
    await server.close();
    await app.close();
  }
});

it('keeps an existing email account separate from a Google identity with the same email', () => {
  const data = persistenceContext();
  try {
    const email = 'same@gmail.com';
    data.db.repositories.insertSession(storedSession('legacy'));
    data.raw
      .prepare('INSERT INTO accounts(session_id,email,password_hash,created_at) VALUES (?,?,?,?)')
      .run('legacy', email, 'legacy-hash', 1);
    expect(
      data.db.accounts.signInGoogle({
        subject: 'google-sub',
        email,
        nickname: 'Google 玩家',
        sessionId: 'google-session',
        disabledGuestHash: 'c'.repeat(64),
        loginHash: 'd'.repeat(64),
        previousLogin: null,
        expires: 200,
        now: 2,
      }),
    ).toBe('google-session');
    expect(data.db.accounts.findAccount(email)).toMatchObject({ session_id: 'legacy' });
    expect(data.db.accounts.emailForSession('google-session')).toBe(email);
  } finally {
    data.close();
  }
});
