import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SessionStatus } from '@orbit/protocol';
import { createResumeToken, hashResumeToken } from '../../apps/server/src/sessions/token.js';
import { ConnectionRegistry } from '../../apps/server/src/sessions/connection-registry.js';
import { createSessionService } from '../../apps/server/src/sessions/session-service.js';
import { defaultResumeContext } from '../../apps/server/src/sessions/resume-context.js';
import { PersistenceError } from '../../apps/server/src/persistence/errors.js';
import {
  sessionContext,
  request,
  rawRequest,
  resumeRequest,
  seedOwnedCompletedHand,
} from '../helpers/session-context.js';
import { connectionTakeoverFixture } from '../helpers/session-scenarios.js';
import { record } from '../helpers/fixture-read.js';
const contexts: Awaited<ReturnType<typeof sessionContext>>[] = [];
async function context() {
  const c = await sessionContext();
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it('issues distinct 32-byte private tokens and stores only their digest with fixed thirty-day expiry', async () => {
  const c = await context(),
    a = await c.connect(),
    b = await c.connect(),
    seen: unknown[] = [];
  b.onAny((...args: unknown[]) => seen.push(args));
  const g = await request(a, 'session:guest', { requestId: randomUUID(), nickname: '  A  ' });
  expect(g.ok).toBe(true);
  if (!g.ok) throw new Error(g.code);
  expect(g.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(g.expiresAt).toBe(c.clock.now + 30 * 86400000);
  expect(g.connectionGeneration).toBe(1);
  expect(g.serverEpoch).toBe('boot1');
  const row = c.storage.db.repositories.findSessionById(g.sessionId)!;
  expect(row.tokenHash).toBe(hashResumeToken(g.resumeToken));
  expect(row.nickname).toBe('A');
  expect(JSON.stringify(c.storage.raw.prepare('SELECT * FROM sessions').all())).not.toContain(
    g.resumeToken,
  );
  expect(JSON.stringify(seen)).not.toContain(g.resumeToken);
  expect(JSON.stringify(seen)).not.toContain(row.tokenHash);
  const h = await request(b, 'session:guest', { requestId: randomUUID(), nickname: 'B' });
  expect(h.ok).toBe(true);
  if (!h.ok) throw new Error(h.code);
  expect(h.resumeToken).not.toBe(g.resumeToken);
  expect(h.sessionId).not.toBe(g.sessionId);
  const again = await request(a, 'session:guest', {
    requestId: randomUUID(),
    nickname: 'replacement',
  });
  expect(again).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  expect(c.runtime.registry.getBySocket(a.id!)?.sessionId).toBe(g.sessionId);
});
it('uses grapheme-aware names and rejects malformed requests without credential or foreign metadata leaks', async () => {
  const c = await context(),
    a = await c.connect();
  for (const nickname of ['', '   ', 'a'.repeat(13), 'A\n'])
    expect(await request(a, 'session:guest', { requestId: randomUUID(), nickname })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    });
  const bad = record(
    await rawRequest(a, 'session:guest', {
      requestId: 'invalid',
      nickname: 'A',
      sessionId: 'victim',
    }),
  );
  expect(bad).toMatchObject({
    ok: false,
    code: 'INVALID_INPUT',
    requestId: null,
    roomId: null,
    handId: null,
    latestRoomVersion: null,
    latestHandVersion: null,
  });
  expect('resumeToken' in bad).toBe(false);
  expect('tokenHash' in bad).toBe(false);
  for (const nickname of ['🙂'.repeat(12), '👨‍👩‍👧‍👦'.repeat(12), 'e\u0301'.repeat(12)]) {
    const socket = await c.connect();
    expect((await request(socket, 'session:guest', { requestId: randomUUID(), nickname })).ok).toBe(
      true,
    );
  }
});
it('PRIV04 takes over a real connected controller and a late old disconnect cannot revoke the new one', async () => {
  const f = connectionTakeoverFixture(),
    c = await context(),
    a = await c.connect(),
    b = await c.connect();
  const issued = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  if (!issued.ok) throw new Error(issued.code);
  const aid = a.id!,
    old = c.runtime.registry.getBySocket(aid)!;
  expect(old.connectionGeneration).toBe(f.oldGeneration);
  const status = new Promise<SessionStatus>((resolve) => a.once('session:status', resolve));
  const resumed = await request(b, 'session:resume', resumeRequest(issued.resumeToken));
  expect(resumed).toMatchObject({
    ok: true,
    outcome: 'identityOnly',
    reason: 'notSeated',
    connectionGeneration: f.newGeneration,
  });
  expect(await status).toMatchObject({
    status: 'takenOver',
    connectionGeneration: f.newGeneration,
  });
  expect(a.connected).toBe(true);
  expect('resumeToken' in resumed).toBe(false);
  const current = c.runtime.registry.getBySocket(b.id!)!,
    before = c.storage.db.repositories.findSessionById(issued.sessionId);
  expect(c.runtime.service.checkController(old)).toEqual({
    ok: f.expected.accepted,
    reason: f.expected.error,
  });
  expect(c.runtime.service.checkController(current).ok).toBe(f.expected.newConnectionControlsSeat);
  expect(c.storage.db.repositories.findSessionById(issued.sessionId)).toEqual(before);
  a.disconnect();
  await expect.poll(() => c.runtime.registry.getBySocket(aid)).toBeNull();
  expect(c.runtime.service.checkController(current).ok).toBe(true);
});
it('serializes competing resume claims into durable generations with exactly one current controller', async () => {
  const c = await context(),
    a = await c.connect(),
    b = await c.connect(),
    d = await c.connect(),
    issued = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  if (!issued.ok) throw new Error(issued.code);
  const responses = await Promise.all([
    request(b, 'session:resume', resumeRequest(issued.resumeToken)),
    request(d, 'session:resume', resumeRequest(issued.resumeToken)),
  ]);
  expect(responses.every((r) => r.ok)).toBe(true);
  expect(responses.map((r) => (r.ok ? r.connectionGeneration : 0)).sort()).toEqual([2, 3]);
  const contexts = [c.runtime.registry.getBySocket(b.id!)!, c.runtime.registry.getBySocket(d.id!)!];
  expect(contexts.filter((x) => c.runtime.service.checkController(x).ok)).toHaveLength(1);
  expect(c.storage.db.repositories.findSessionById(issued.sessionId)?.connectionGeneration).toBe(3);
});
it('rejects wrong, noncanonical and expired tokens without replacing identity or refreshing its expiry', async () => {
  const c = await context(),
    a = await c.connect(),
    b = await c.connect(),
    g = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  if (!g.ok) throw new Error(g.code);
  expect(() => hashResumeToken('A'.repeat(42) + 'B')).toThrow('SESSION_EXPIRED');
  for (const token of ['', 'bad', 'A'.repeat(44), 'A'.repeat(42) + 'B', createResumeToken()])
    expect(await request(b, 'session:resume', resumeRequest(token))).toMatchObject({
      ok: false,
      code: 'SESSION_EXPIRED',
    });
  expect(c.runtime.registry.getBySocket(b.id!)).toBeNull();
  expect(c.storage.db.repositories.findSessionById(g.sessionId)?.connectionGeneration).toBe(1);
  c.clock.now += 120001;
  expect((await request(b, 'session:resume', resumeRequest(g.resumeToken))).ok).toBe(true);
  c.clock.now = g.expiresAt - 86400000;
  expect((await request(b, 'session:resume', resumeRequest(g.resumeToken))).ok).toBe(true);
  c.clock.now = g.expiresAt;
  expect(await request(b, 'session:resume', resumeRequest(g.resumeToken))).toMatchObject({
    ok: false,
    code: 'SESSION_EXPIRED',
  });
  c.clock.now++;
  expect(await request(b, 'session:resume', resumeRequest(g.resumeToken))).toMatchObject({
    ok: false,
    code: 'SESSION_EXPIRED',
  });
  expect(c.storage.db.repositories.findSessionById(g.sessionId)?.expiresAt).toBe(g.expiresAt);
});
it('leaves the previous controller and persisted generation intact when SQLite cannot commit a claim', async () => {
  const c = await context(),
    a = await c.connect(),
    b = await c.connect(),
    g = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  if (!g.ok) throw new Error(g.code);
  const old = c.runtime.registry.getBySocket(a.id!)!;
  c.storage.raw.exec('BEGIN IMMEDIATE');
  try {
    expect(await request(b, 'session:resume', resumeRequest(g.resumeToken))).toMatchObject({
      ok: false,
      code: 'PERSISTENCE_UNAVAILABLE',
    });
    const d = await c.connect();
    expect(
      await request(d, 'session:guest', { requestId: randomUUID(), nickname: 'new' }),
    ).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
    expect(c.runtime.registry.getBySocket(d.id!)).toBeNull();
  } finally {
    c.storage.raw.exec('ROLLBACK');
  }
  expect(c.runtime.service.checkController(old).ok).toBe(true);
  expect(c.runtime.registry.getBySocket(b.id!)).toBeNull();
  expect(c.storage.db.repositories.findSessionById(g.sessionId)?.connectionGeneration).toBe(1);
});
it('authenticates after a real server/database restart and retains only owned completed history metadata', async () => {
  const c = await context(),
    a = await c.connect(),
    g = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  if (!g.ok) throw new Error(g.code);
  seedOwnedCompletedHand(c, g.sessionId);
  expect(c.storage.db.repositories.listOwnedHandIds(g.sessionId)).toEqual(['h1']);
  await c.restart();
  const b = await c.connect(),
    r = await request(
      b,
      'session:resume',
      resumeRequest(g.resumeToken, { roomId: 'r1', lastSeenHandId: 'h1' }),
    );
  expect(r).toMatchObject({
    ok: true,
    serverEpoch: 'boot2',
    outcome: 'identityOnly',
    reason: 'roomClosed',
    connectionGeneration: 2,
  });
  expect(c.storage.db.repositories.listOwnedHandIds(g.sessionId)).toEqual(['h1']);
  const outsider = await c.connect(),
    other = await request(outsider, 'session:guest', { requestId: randomUUID(), nickname: 'B' });
  if (!other.ok) throw new Error(other.code);
  expect(c.storage.db.repositories.listOwnedHandIds(other.sessionId)).toEqual([]);
});
it('verifies ownership and stored interruption state rather than trusting foreign room and hand hints', async () => {
  const c = await context(),
    a = await c.connect(),
    b = await c.connect(),
    g = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  if (!g.ok) throw new Error(g.code);
  seedOwnedCompletedHand(c, g.sessionId);
  c.storage.raw
    .prepare('UPDATE hands SET status=?,result_json=NULL WHERE hand_id=?')
    .run('interrupted', 'h1');
  expect(
    await request(
      b,
      'session:resume',
      resumeRequest(g.resumeToken, { roomId: 'r1', lastSeenHandId: 'h1' }),
    ),
  ).toMatchObject({ ok: true, outcome: 'handInterrupted', interruptedHandId: 'h1' });
  const d = await c.connect(),
    h = await request(d, 'session:guest', { requestId: randomUUID(), nickname: 'B' });
  if (!h.ok) throw new Error(h.code);
  const r = await request(
    d,
    'session:resume',
    resumeRequest(h.resumeToken, { roomId: 'r1', lastSeenHandId: 'h1' }),
  );
  expect(r).toMatchObject({
    ok: true,
    outcome: 'identityOnly',
    reason: 'notSeated',
    roomView: null,
    playerView: null,
  });
  expect('interruptedHandId' in r).toBe(false);
  c.storage.raw
    .prepare('UPDATE hands SET status=?,ended_at=NULL WHERE hand_id=?')
    .run('active', 'h1');
  const active = await request(
    b,
    'session:resume',
    resumeRequest(g.resumeToken, { lastSeenHandId: 'h1' }),
  );
  expect(active).toMatchObject({ ok: true, outcome: 'identityOnly', reason: 'notSeated' });
});
it('ignores identity packets without ack and never treats URL token parameters as authentication', async () => {
  const c = await context(),
    a = await c.connect();
  a.emit('session:guest', { requestId: randomUUID(), nickname: 'ignored' });
  const g = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  expect(g.ok).toBe(true);
  if (!g.ok) throw new Error(g.code);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM sessions').get()?.n).toBe(1);
  const b = await c.connect({ resumeToken: g.resumeToken });
  expect(c.runtime.registry.getBySocket(b.id!)).toBeNull();
});
it('refuses generation overflow without wrapping or binding a new controller', async () => {
  const c = await context(),
    a = await c.connect(),
    b = await c.connect(),
    g = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  if (!g.ok) throw new Error(g.code);
  c.storage.raw
    .prepare('UPDATE sessions SET connection_generation=? WHERE session_id=?')
    .run(Number.MAX_SAFE_INTEGER, g.sessionId);
  expect(await request(b, 'session:resume', resumeRequest(g.resumeToken))).toMatchObject({
    ok: false,
    code: 'PERSISTENCE_UNAVAILABLE',
  });
  expect(c.runtime.registry.getBySocket(b.id!)).toBeNull();
  expect(c.storage.db.repositories.findSessionById(g.sessionId)?.connectionGeneration).toBe(
    Number.MAX_SAFE_INTEGER,
  );
});
it('conditionally releases stale same-socket contexts and handles identity switching without revoking other controllers', () => {
  const registry = new ConnectionRegistry(),
    a = { socketId: 'a', sessionId: 's', connectionGeneration: 1 },
    b = { socketId: 'a', sessionId: 's', connectionGeneration: 2 };
  registry.bind(a);
  registry.bind(b);
  registry.release(a);
  expect(registry.isCurrent(b)).toBe(true);
  expect(registry.getBySocket('a')).toEqual(b);
  const d = { socketId: 'd', sessionId: 's', connectionGeneration: 3 };
  registry.bind(d);
  registry.bind({ socketId: 'a', sessionId: 'other', connectionGeneration: 1 });
  expect(registry.isCurrent(d)).toBe(true);
});
it('bounds genuine unique-conflict issuance retries without treating a new guest as taken over', async () => {
  const c = await context(),
    registry = new ConnectionRegistry();
  let attempts = 0;
  const repository = {
    ...c.storage.db.repositories,
    insertSession() {
      attempts++;
      throw new PersistenceError('PERSISTENCE_CONFLICT');
    },
  };
  const service = createSessionService(
    {
      repository,
      now: () => c.clock.now,
      serverEpoch: 'collision',
      contextResolver: defaultResumeContext(repository),
    },
    registry,
  );
  const r = service.guest('new', { requestId: randomUUID(), nickname: 'A' });
  expect(r).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
  expect(attempts).toBe(3);
  expect(registry.getBySocket('new')).toBeNull();
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM sessions').get()?.n).toBe(0);
});
it('keeps a committed takeover successful when a status observer fails', async () => {
  const c = await context(),
    a = await c.connect(),
    b = await c.connect(),
    g = await request(a, 'session:guest', { requestId: randomUUID(), nickname: 'A' });
  if (!g.ok) throw new Error(g.code);
  const remove = c.runtime.onTakeover(() => {
    throw new Error('notification failure');
  });
  try {
    const r = await request(b, 'session:resume', resumeRequest(g.resumeToken));
    expect(r).toMatchObject({ ok: true, connectionGeneration: 2 });
    expect(c.runtime.service.checkController(c.runtime.registry.getBySocket(b.id!)!).ok).toBe(true);
  } finally {
    remove();
  }
});
it('rejects unsafe clock or expiry arithmetic without issuing credentials or changing storage', async () => {
  const c = await context();
  for (const now of [NaN, Number.MAX_SAFE_INTEGER]) {
    const registry = new ConnectionRegistry(),
      repository = c.storage.db.repositories,
      service = createSessionService(
        {
          repository,
          now: () => now,
          serverEpoch: 'clock',
          contextResolver: defaultResumeContext(repository),
        },
        registry,
      );
    const r = service.guest('clock', { requestId: randomUUID(), nickname: 'A' });
    expect(r).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
    expect(Number.isSafeInteger(r.serverTime)).toBe(true);
    expect('resumeToken' in r).toBe(false);
    expect(registry.getBySocket('clock')).toBeNull();
  }
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM sessions').get()?.n).toBe(0);
});
