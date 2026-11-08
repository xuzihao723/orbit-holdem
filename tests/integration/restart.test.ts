import { afterEach, expect, it } from 'vitest';
import { timerContext } from '../helpers/timer-context.js';
import { lifecycleContext } from '../helpers/lifecycle-context.js';
import { lifecycleScenario } from '../helpers/lifecycle-scenarios.js';
import { array, record, text } from '../helpers/fixture-read.js';
import { createPokerServer } from '../../apps/server/src/create-server.js';
import { io } from 'socket.io-client';
import { request, resumeRequest } from '../helpers/session-context.js';
import {
  createApplicationRuntime,
  type ApplicationRuntime,
} from '../../apps/server/src/application-runtime.js';
const contexts: Awaited<ReturnType<typeof timerContext>>[] = [],
  apps: ApplicationRuntime[] = [];
it('LIFE12 archives running and waiting rooms, preserves completed ownership, and returns handInterrupted through a real new server', async () => {
  const f = lifecycleScenario('LIFE12'),
    variant = record(array(f.given.variants)[1]),
    expected = record(f.expected.restart),
    c = await lifecycleContext();
  let replacement: ReturnType<typeof createPokerServer> | undefined,
    a: ApplicationRuntime | undefined;
  let socket: ReturnType<typeof io> | undefined;
  try {
    await c.start();
    const first = c.room().hand!;
    expect(
      await c.command(c.humans[0]!.socket, 'game:action', {
        commandId: crypto.randomUUID(),
        roomId: c.roomId,
        handId: first.handId,
        turnId: first.turnId!,
        expectedVersion: first.handVersion,
        action: { type: 'fold' },
      }),
    ).toMatchObject({ ok: true });
    const bytes = c.storage.raw
      .prepare('SELECT result_json FROM hands WHERE hand_id=?')
      .get(first.handId);
    await c.start();
    const running = c.room().hand!.handId,
      guest = await c.guest('Waiting'),
      made = await c.command(guest.socket, 'room:create', {
        commandId: crypto.randomUUID(),
        capacity: 2,
        nickname: 'Waiting',
      });
    expect(made.ok).toBe(true);
    await c.app.close();
    a = createApplicationRuntime({
      database: c.storage.db,
      serverEpoch: text(variant.newEpoch),
      now: () => 10000,
    });
    replacement = createPokerServer({ port: 0, application: a });
    const origin = (await replacement.listen()).origin;
    socket = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false });
    await new Promise<void>((r, j) => {
      socket!.once('connect', r);
      socket!.once('connect_error', j);
    });
    expect(
      await request(
        socket,
        'session:resume',
        resumeRequest(c.humans[0]!.resumeToken, { roomId: c.roomId, lastSeenHandId: running }),
      ),
    ).toMatchObject({ ok: true, outcome: 'handInterrupted', interruptedHandId: running });
    expect(c.storage.db.hands.readHand(running)!.status).toBe(expected.h_running);
    expect(c.storage.db.hands.readHand(first.handId)!.status).toBe(expected.h_done);
    expect(c.storage.db.repositories.listOwnedHandIds(c.humans[0]!.sessionId)).toContain(
      first.handId,
    );
    expect(
      c.storage.raw.prepare('SELECT result_json FROM hands WHERE hand_id=?').get(first.handId),
    ).toEqual(bytes);
    expect(
      c.storage.raw.prepare("SELECT COUNT(*) n FROM rooms WHERE status<>'closed'").get()?.n,
    ).toBe(0);
  } finally {
    socket?.disconnect();
    await replacement?.close();
    await a?.close();
    await c.close();
  }
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const c of contexts.splice(0)) await c.close();
});
it('archives an old active hand and room without changing the last committed balances, events or sessions', async () => {
  const c = await timerContext();
  contexts.push(c);
  const h = c.hand(),
    balances = c.storage.raw
      .prepare('SELECT participant_id,stack FROM participants ORDER BY participant_id')
      .all(),
    count = c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n;
  await c.app.close();
  const a = createApplicationRuntime({
    database: c.storage.db,
    serverEpoch: 'restarted',
    now: () => 10000,
  });
  apps.push(a);
  expect(c.storage.db.hands.readHand(h.handId)).toMatchObject({
    status: 'interrupted',
    result: null,
    handVersion: h.handVersion,
    endedAt: 10000,
  });
  expect(c.storage.db.rooms.readRoom(c.roomId)!.room.status).toBe('closed');
  expect(
    c.storage.raw
      .prepare('SELECT participant_id,stack FROM participants ORDER BY participant_id')
      .all(),
  ).toEqual(balances);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(count);
  expect(c.storage.db.repositories.findSessionById(c.humans[0]!.sessionId)).toBeTruthy();
});
it('preserves settled result bytes and archived timestamps across repeated boots', async () => {
  const c = await timerContext();
  contexts.push(c);
  await c.play({ type: 'fold' });
  const row = c.storage.raw.prepare('SELECT result_json FROM hands').get()!;
  await c.app.close();
  for (const [epoch, now] of [
    ['next', 10000],
    ['again', 20000],
  ] as const) {
    const a = createApplicationRuntime({
      database: c.storage.db,
      serverEpoch: epoch,
      now: () => now,
    });
    await a.close();
  }
  expect(c.storage.raw.prepare('SELECT result_json FROM hands').get()).toEqual(row);
  expect(c.storage.raw.prepare('SELECT closed_at FROM rooms').get()?.closed_at).toBe(10000);
});
it('rolls back the entire startup archive if a real SQL trigger rejects any room write', async () => {
  const c = await timerContext();
  contexts.push(c);
  const handId = c.hand().handId;
  await c.app.close();
  c.storage.raw.exec(
    "CREATE TRIGGER reject_archive BEFORE UPDATE OF status ON rooms WHEN NEW.status='closed' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  expect(() =>
    createApplicationRuntime({ database: c.storage.db, serverEpoch: 'failed', now: () => 10000 }),
  ).toThrow();
  expect(c.storage.db.hands.readHand(handId)?.status).toBe('active');
  expect(c.storage.db.rooms.readRoom(c.roomId)!.room.status).toBe('playing');
  expect(c.storage.raw.isTransaction).toBe(false);
});
