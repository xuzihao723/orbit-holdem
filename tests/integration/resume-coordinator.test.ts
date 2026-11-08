import { afterEach, expect, it } from 'vitest';
import { roomContext } from '../helpers/room-context.js';
import { FakeClock } from '../helpers/fake-clock.js';
import { waitUntil } from '../helpers/reconnect-context.js';
import { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import { memoryCredentialStore } from '../../apps/web/src/network/credential-store.js';
import { ResumeCoordinator } from '../../apps/web/src/network/resume-session.js';
import { requestFailure } from '../../apps/server/src/sessions/responses.js';
import { randomUUID } from 'node:crypto';
it('arms recovery for a newly issued guest without issuing a second identity request', async () => {
  const { client, coordinator } = await setup(false);
  await client.connect();
  await client.guest('New');
  let calls = 0;
  const resume = client.resume;
  client.resume = async () => {
    calls++;
    return resume();
  };
  coordinator.watch();
  expect(calls).toBe(0);
  client.disconnect();
  client.permitRecovery();
  client.store.disconnect();
  await waitUntil(() => calls === 1 && client.store.snapshot.controlReady);
});
it('allows an explicit manual restart after exhausting all retries', async () => {
  const { client, clock, coordinator } = await setup(),
    connect = client.connect.bind(client);
  let calls = 0;
  client.connect = async () => {
    calls++;
    throw Error('offline');
  };
  await coordinator.start();
  await clock.advanceTo(20000);
  expect(calls).toBe(6);
  client.connect = async () => {
    calls++;
    return connect();
  };
  await coordinator.start();
  expect(calls).toBe(7);
  expect(client.store.snapshot.controlReady).toBe(true);
});
it('backs off when the real connection receives a retryable private failure response', async () => {
  const { c, client, clock, coordinator } = await setup(),
    resume = client.resume;
  let calls = 0;
  client.resume = async () =>
    ++calls === 1
      ? requestFailure(c.app.sessions.meta(), randomUUID(), 'PERSISTENCE_UNAVAILABLE')
      : resume();
  await coordinator.start();
  expect(clock.pending).toBe(1);
  await clock.advanceTo(500);
  await waitUntil(() => client.store.snapshot.controlReady);
  expect(calls).toBe(2);
});
it('preserves expired as a terminal state across transport disconnection', async () => {
  const { client, clock, coordinator } = await setup();
  await coordinator.start();
  client.store.receiveStatus({
    protocolVersion: 1,
    serverEpoch: client.store.snapshot.activeEpoch!,
    serverTime: 1000,
    status: 'expired',
    connectionGeneration: null,
  });
  let calls = 0;
  client.connect = async () => {
    calls++;
    throw Error('must not reconnect');
  };
  client.store.disconnect();
  await clock.advanceTo(20000);
  expect(client.store.snapshot.status).toBe('expired');
  expect(calls).toBe(0);
});
const resources: { close(): void | Promise<void> }[] = [];
afterEach(async () => {
  for (const r of resources.splice(0).reverse()) await r.close();
});
async function setup(seed = true) {
  const c = await roomContext();
  resources.push(c);
  const credentials = memoryCredentialStore();
  if (seed) {
    const owner = await c.guest('Owner');
    credentials.write({
      sessionId: owner.sessionId,
      resumeToken: owner.resumeToken,
      expiresAt: owner.expiresAt,
    });
  }
  const client = createSocketClient({ url: c.origin, credentials });
  resources.push(client);
  const clock = new FakeClock();
  clock.flush = () => new Promise((r) => setTimeout(r, 0));
  const coordinator = new ResumeCoordinator(client, { clock });
  resources.push(coordinator);
  return { c, client, clock, coordinator };
}
it('retries bounded transient connection failures and then resumes the real saved identity', async () => {
  const { client, clock, coordinator } = await setup(),
    connect = client.connect.bind(client);
  let calls = 0;
  client.connect = async () => {
    if (++calls < 3) throw Error('fixture network failure');
    return connect();
  };
  await coordinator.start();
  expect(calls).toBe(1);
  expect(clock.pending).toBe(1);
  await clock.advanceTo(499);
  expect(calls).toBe(1);
  await clock.advanceTo(500);
  expect(calls).toBe(2);
  await clock.advanceTo(1500);
  await waitUntil(() => client.store.snapshot.controlReady);
  expect(calls).toBe(3);
  expect(client.store.snapshot.authContext?.sessionId).toBe(client.credentials.read()!.sessionId);
  expect(clock.pending).toBe(0);
});
it('stops after six failed attempts without creating a replacement guest', async () => {
  const { c, client, clock, coordinator } = await setup();
  let calls = 0;
  client.connect = async () => {
    calls++;
    throw Error('offline');
  };
  await coordinator.start();
  await clock.advanceTo(20000);
  expect(calls).toBe(6);
  expect(clock.pending).toBe(0);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM sessions').get()?.n).toBe(1);
});
it('cancels scheduled retries and never starts authentication without saved credentials', async () => {
  const { client, clock, coordinator } = await setup(false);
  let calls = 0;
  client.connect = async () => {
    calls++;
    throw Error('offline');
  };
  await coordinator.start();
  expect(calls).toBe(0);
  expect(clock.pending).toBe(0);
  const saved = await setup();
  saved.client.connect = async () => {
    calls++;
    throw Error('offline');
  };
  await saved.coordinator.start();
  expect(saved.clock.pending).toBe(1);
  saved.coordinator.stop();
  await saved.clock.advanceTo(20000);
  expect(calls).toBe(1);
  expect(saved.clock.pending).toBe(0);
});
it('does not auto-resume a taken-over client or delete its shared credentials', async () => {
  const { client, clock, coordinator } = await setup();
  await coordinator.start();
  const saved = client.credentials.read()!;
  client.store.receiveStatus({
    protocolVersion: 1,
    serverEpoch: client.store.snapshot.activeEpoch!,
    serverTime: 1000,
    status: 'takenOver',
    connectionGeneration: 3,
  });
  await clock.advanceTo(20000);
  expect(client.store.snapshot.status).toBe('takenOver');
  expect(client.credentials.read()).toEqual(saved);
  expect(clock.pending).toBe(0);
});
