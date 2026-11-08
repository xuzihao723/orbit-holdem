import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { roomContext } from '../helpers/room-context.js';
import { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import { memoryCredentialStore } from '../../apps/web/src/network/credential-store.js';
import { memoryRoomLocatorStore } from '../../apps/web/src/network/room-locator-store.js';
import { timerContext } from '../helpers/timer-context.js';
it('cancels an unfinished transport connection immediately on explicit disconnect', async () => {
  const client = createSocketClient({ url: 'http://127.0.0.1:9', timeoutMs: 100 });
  resources.push(client);
  const pending = client.connect();
  client.disconnect();
  await expect(pending).rejects.toThrow('CONTROL_UNAVAILABLE');
});
it('receives the committed current hand result after refreshing a settled room', async () => {
  const c = await timerContext();
  resources.push(c);
  await c.play({ type: 'fold' });
  const h = c.humans[0]!,
    credentials = memoryCredentialStore(),
    locator = memoryRoomLocatorStore();
  credentials.write({ sessionId: h.sessionId, resumeToken: h.resumeToken, expiresAt: h.expiresAt });
  locator.write({
    sessionId: h.sessionId,
    roomId: c.roomId,
    roomCode: c.readRoom(c.roomId).row.roomCode,
    lastSeenHandId: c.hand().handId,
    lastSeenRoomVersion: c.readRoom(c.roomId).row.roomVersion,
    lastSeenHandVersion: c.hand().handVersion,
  });
  const client = createSocketClient({ url: c.origin, credentials, locator });
  resources.push(client);
  await client.connect();
  expect(await client.resume()).toMatchObject({ ok: true, outcome: 'seatRestored' });
  await expect.poll(() => client.store.snapshot.result?.handId).toBe(c.hand().handId);
  expect(client.store.snapshot.result!.finalStacks.map((p) => p.stack)).toEqual(
    c.hand().players.map((p) => p.stack),
  );
});
it('restores a newly opened client to its explicitly saved room when the identity owns several rooms', async () => {
  const c = await roomContext();
  resources.push(c);
  const credentials = memoryCredentialStore(),
    locator = memoryRoomLocatorStore(),
    a = createSocketClient({ url: c.origin, credentials, locator });
  resources.push(a);
  await a.connect();
  await a.guest('A');
  await a.sendCommand('room:create', { commandId: randomUUID(), capacity: 2, nickname: 'First' });
  const second = await a.sendCommand('room:create', {
    commandId: randomUUID(),
    capacity: 3,
    nickname: 'Second',
  });
  if (!second.ok) throw Error(second.code);
  await expect.poll(() => a.store.snapshot.roomView?.roomId).toBe(second.roomId);
  expect(locator.read()?.roomId).toBe(second.roomId);
  a.close();
  const b = createSocketClient({ url: c.origin, credentials, locator });
  resources.push(b);
  await b.connect();
  expect(await b.resume()).toMatchObject({
    ok: true,
    outcome: 'seatRestored',
    roomView: { roomId: second.roomId },
  });
  expect(b.store.snapshot.authContext?.participantId).toBeTruthy();
  expect(JSON.stringify(locator.read())).not.toContain(credentials.read()!.resumeToken);
});
const resources: { close(): Promise<void> | void }[] = [];
it('matches each concurrent duplicate send to a distinct acknowledgement and rejects changed in-flight intent', async () => {
  const { a } = await setup();
  await a.guest('A');
  const payload = { commandId: randomUUID(), capacity: 2 as const, nickname: 'A' };
  const first = a.sendCommand('room:create', payload),
    second = a.sendCommand('room:create', payload);
  await expect(a.sendCommand('room:create', { ...payload, capacity: 4 })).rejects.toThrow(
    'COMMAND_ID_CONFLICT',
  );
  const acks = await Promise.all([first, second]);
  expect(acks.every((a) => a.ok)).toBe(true);
  expect(acks.filter((a) => a.duplicate)).toHaveLength(1);
});
it('revokes a still-connected identity when a business acknowledgement reports expiry', async () => {
  const { c, a, credentials } = await setup();
  await a.guest('A');
  c.clock.now = credentials.read()!.expiresAt + 1;
  expect(
    await a.sendCommand('room:create', { commandId: randomUUID(), capacity: 2, nickname: 'A' }),
  ).toMatchObject({ code: 'SESSION_EXPIRED' });
  expect(a.connected).toBe(true);
  expect(a.store.snapshot.status).toBe('expired');
  expect(a.store.snapshot.controlReady).toBe(false);
  expect(a.store.snapshot.playerView).toBeNull();
});
it('cancels old waiters on shared credential change and requires a fresh client for the replacement identity', async () => {
  const { c, a } = await setup();
  await a.guest('A');
  const execute = c.app.rooms.execute.bind(c.app.rooms);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  c.app.rooms.execute = async (cmd) => {
    await gate;
    return execute(cmd);
  };
  const pending = a
    .sendCommand('room:create', { commandId: randomUUID(), capacity: 2, nickname: 'A' })
    .catch((e: Error) => e.message);
  const replacement = await c.guest('B');
  a.credentials.write({
    sessionId: replacement.sessionId,
    resumeToken: replacement.resumeToken,
    expiresAt: replacement.expiresAt,
  });
  expect(() => a.resume()).toThrow('ENTRY_IDENTITY_CHANGED');
  expect(await pending).toBe('CONTROL_UNAVAILABLE');
  release();
  await new Promise((r) => setTimeout(r, 30));
  expect(a.store.snapshot.status).toBe('disconnected');
  expect(a.store.snapshot.controlReady).toBe(false);
  const fresh = createSocketClient({ url: c.origin, credentials: a.credentials });
  resources.push(fresh);
  await fresh.connect();
  expect((await fresh.resume()).ok).toBe(true);
  expect(fresh.store.snapshot.status).toBe('ready');
  expect(fresh.store.snapshot.controlReady).toBe(true);
});
afterEach(async () => {
  for (const r of resources.splice(0).reverse()) await r.close();
});
async function setup(timeoutMs = 1000) {
  const c = await roomContext();
  resources.push(c);
  const credentials = memoryCredentialStore(),
    a = createSocketClient({ url: c.origin, credentials, timeoutMs });
  resources.push(a);
  await a.connect();
  return { c, a, credentials };
}
it('authenticates privately and synchronizes real room snapshots without speculative chips', async () => {
  const { c, a, credentials } = await setup();
  const issued = await a.guest('A');
  expect(issued.ok).toBe(true);
  expect(credentials.read()?.resumeToken).toBeTruthy();
  const made = await a.sendCommand('room:create', {
    commandId: randomUUID(),
    capacity: 2,
    nickname: 'A',
  });
  expect(made.ok).toBe(true);
  await expect.poll(() => a.store.snapshot.roomView?.seats[0]?.occupant?.stack).toBe(2000);
  expect(JSON.stringify(a.store.snapshot)).not.toContain(credentials.read()!.resumeToken);
  expect(c.app.sessions.registry.getCurrent(credentials.read()!.sessionId)).toBeTruthy();
});
it('taken-over client remains connected but cannot mutate or delete the shared credential', async () => {
  const { c, a, credentials } = await setup();
  await a.guest('A');
  const token = credentials.read()!.resumeToken,
    b = createSocketClient({ url: c.origin, credentials });
  resources.push(b);
  await b.connect();
  expect((await b.resume()).ok).toBe(true);
  await expect.poll(() => a.store.snapshot.status).toBe('takenOver');
  expect(a.connected).toBe(true);
  expect(credentials.read()!.resumeToken).toBe(token);
  await expect(
    a.sendCommand('room:create', { commandId: randomUUID(), capacity: 2, nickname: 'A' }),
  ).rejects.toThrow('CONTROL_UNAVAILABLE');
  expect(c.app.rooms.store.all()).toHaveLength(0);
});
it('does not buffer offline mutations or automatically mint a replacement expired identity', async () => {
  const { c, a, credentials } = await setup();
  await a.guest('A');
  const identity = credentials.read()!;
  a.disconnect();
  await expect(
    a.sendCommand('room:create', { commandId: randomUUID(), capacity: 2, nickname: 'A' }),
  ).rejects.toThrow('CONTROL_UNAVAILABLE');
  c.clock.now = identity.expiresAt + 1;
  await a.connect();
  expect(await a.resume()).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' });
  expect(a.store.snapshot.status).toBe('expired');
  expect(credentials.read()!.sessionId).toBe(identity.sessionId);
  expect(c.app.rooms.store.all()).toHaveLength(0);
});
it('marks a lost acknowledgement uncertain without replaying or predicting room state', async () => {
  const { c, a } = await setup(100);
  await a.guest('A');
  const original = c.app.rooms.execute.bind(c.app.rooms);
  c.app.rooms.execute = async (command) => {
    await new Promise((r) => setTimeout(r, 200));
    return original(command);
  };
  const id = randomUUID();
  await expect(
    a.sendCommand('room:create', { commandId: id, capacity: 2, nickname: 'A' }),
  ).rejects.toThrow('ACK_UNCERTAIN');
  expect(a.store.snapshot.pending[id]!.status).toBe('uncertain');
  await expect.poll(() => c.app.rooms.store.all().length).toBe(1);
  await expect.poll(() => a.store.snapshot.pending[id]!.status).toBe('confirmed');
});
