import { recoveryScenario, reservationScenario } from '../helpers/lifecycle-scenarios.js';
import { afterEach, expect, it, vi } from 'vitest';
import * as playerViews from '../../apps/server/src/game/player-view.js';
import { createSessionService } from '../../apps/server/src/sessions/session-service.js';
import { liveResumeContext } from '../../apps/server/src/sessions/live-resume-context.js';
it('does not restore a seat that left between snapshot generation and final authentication acceptance', async () => {
  const c = await context();
  await c.play({ type: 'fold' });
  const next = await c.guest('Next'),
    repository = c.app.database.repositories,
    live = liveResumeContext(c.app.rooms, c.app.sessions, c.app.reservations, repository);
  const service = createSessionService(
    {
      repository,
      now: c.clock.now,
      serverEpoch: c.app.serverEpoch,
      contextResolver: {
        async resolve(input) {
          const result = await live.resolve(input);
          expect(
            await c.app.rooms.execute({
              event: 'room:leave',
              payload: { commandId: randomUUID(), roomId: c.roomId },
              control: input.control!,
              receivedAt: c.clock.now(),
            }),
          ).toMatchObject({ ok: true });
          return result;
        },
        finalize(input, result) {
          return live.finalize?.(input, result) ?? result;
        },
      },
    },
    c.app.sessions.registry,
  );
  expect(
    await service.resume(next.socket.id!, resumeRequest(c.owner.resumeToken, { roomId: c.roomId })),
  ).toMatchObject({
    ok: true,
    outcome: 'identityOnly',
    reason: 'seatExpired',
    roomView: null,
    playerView: null,
  });
});
it('restores a waiting member with public board but no owner cards or legal actions', async () => {
  const c = await context(),
    waiting = await c.guest('Waiting');
  expect(
    await c.command(waiting.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'Waiting',
    }),
  ).toMatchObject({ ok: true });
  waiting.socket.disconnect();
  await waitUntil(() => c.app.sessions.registry.getCurrent(waiting.sessionId) === null);
  const next = await c.guest('Next');
  expect(
    await request(
      next.socket,
      'session:resume',
      resumeRequest(waiting.resumeToken, { roomId: c.roomId }),
    ),
  ).toMatchObject({
    ok: true,
    outcome: 'seatRestored',
    playerView: {
      self: { admission: 'waitingNextHand', holeCards: null, legalActions: { allowed: [] } },
    },
  });
});
it('preserves the original reservation when final identity validation fails after a successful projection', async () => {
  const c = await context();
  await c.disconnectOwner();
  await c.clock.advanceTo(119000);
  const next = await c.guest('Next'),
    base = c.app.database.repositories,
    live = liveResumeContext(c.app.rooms, c.app.sessions, c.app.reservations, base);
  let fail = false;
  const repository = {
    ...base,
    findSessionById(id: string) {
      if (fail && id === c.owner.sessionId) throw Error('fixture final read failure');
      return base.findSessionById(id);
    },
  };
  const service = createSessionService(
    {
      repository,
      now: c.clock.now,
      serverEpoch: c.app.serverEpoch,
      contextResolver: {
        async resolve(input) {
          const result = await live.resolve(input);
          fail = true;
          return result;
        },
        finalize(input, result) {
          return live.finalize?.(input, result) ?? result;
        },
      },
    },
    c.app.sessions.registry,
  );
  expect(
    await service.resume(next.socket.id!, resumeRequest(c.owner.resumeToken, { roomId: c.roomId })),
  ).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
  expect(c.app.reservations.get(c.roomId, c.ownerParticipantId)!.reserveUntil).toBe(120000);
});
import { randomUUID } from 'node:crypto';
import { reconnectContext, waitUntil } from '../helpers/reconnect-context.js';
import { request, resumeRequest } from '../helpers/session-context.js';
it('does not extend a reservation when private projection fails after control binding', async () => {
  const c = await context();
  await c.disconnectOwner();
  await c.clock.advanceTo(119000);
  const next = await c.guest('Next'),
    spy = vi.spyOn(playerViews, 'projectPlayerView').mockImplementationOnce(() => {
      throw Error('fixture projection read failure');
    });
  try {
    expect(
      await request(
        next.socket,
        'session:resume',
        resumeRequest(c.owner.resumeToken, { roomId: c.roomId }),
      ),
    ).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
    expect(c.app.reservations.get(c.roomId, c.ownerParticipantId)!.reserveUntil).toBe(120000);
  } finally {
    spy.mockRestore();
  }
});
const contexts: Awaited<ReturnType<typeof reconnectContext>>[] = [];
async function context() {
  const c = await reconnectContext();
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it.each(
  reservationScenario()
    .variants.filter((v) => v.seatRestored)
    .map((v) => v.at),
)('restores the same settled-room seat after %i ms without granting again', async (at) => {
  const c = await context();
  await c.play({ type: 'fold' });
  const balance = c.readRoom(c.roomId).participants[0]!.stack;
  await c.disconnectOwner();
  await c.clock.advanceTo(at);
  const { response } = await c.resumeOwner();
  expect(response).toMatchObject({
    ok: true,
    outcome: 'seatRestored',
    participantId: c.ownerParticipantId,
    playerView: { self: { participantId: c.ownerParticipantId } },
  });
  expect(c.readRoom(c.roomId).participants[0]!.stack).toBe(balance);
  expect(
    c.storage.raw.prepare("SELECT COUNT(*) n FROM chip_ledger WHERE type='seat_grant'").get()?.n,
  ).toBe(2);
});
it('keeps the original live deadline at 20 seconds and the applied fold at 35 seconds', async () => {
  const c = await context(),
    deadline = c.deadline();
  await c.disconnectOwner();
  await c.clock.advanceTo(20000);
  const first = await c.resumeOwner();
  expect(first.response).toMatchObject({
    ok: true,
    outcome: 'seatRestored',
    playerView: {
      deadline,
      self: { participantId: c.ownerParticipantId, holeCards: [...c.hand().players[0]!.holeCards] },
    },
  });
  first.socket.disconnect();
  await waitUntil(() => c.app.sessions.registry.getCurrent(c.owner.sessionId) === null);
  await c.clock.advanceTo(35000);
  const second = await c.resumeOwner();
  expect(second.response).toMatchObject({
    ok: true,
    outcome: 'seatRestored',
    playerView: { phase: 'settled', deadline: null },
  });
  expect(c.hand().players[0]!.folded).toBe(true);
});
it('authenticates at exactly 120 seconds but rejects restoration and new old-seat commands', async () => {
  const c = await context();
  await c.play({ type: 'fold' });
  await c.disconnectOwner();
  await c.clock.advanceTo(120000);
  const { socket, response } = await c.resumeOwner();
  expect(response).toMatchObject({
    ok: true,
    outcome: 'identityOnly',
    reason: 'seatExpired',
    roomView: null,
    playerView: null,
  });
  const frames: unknown[] = [];
  socket.on('game:view', (v) => frames.push(v));
  const h = c.humans[1]!;
  await c.command(h.socket, 'room:ready', {
    commandId: randomUUID(),
    roomId: c.roomId,
    expectedRoomVersion: c.readRoom(c.roomId).row.roomVersion,
    ready: true,
  });
  await new Promise((r) => setTimeout(r, 25));
  expect(frames).toEqual([]);
  expect(
    await c.command(socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'A',
    }),
  ).toMatchObject({ ok: true });
  expect(
    c
      .readRoom(c.roomId)
      .participants.filter((p) => p.sessionId === c.owner.sessionId && p.leftAt === null),
  ).toHaveLength(1);
});
it('restores only the winning control when two private resumes wait on the room queue', async () => {
  const c = await context(),
    one = await c.guest('One'),
    two = await c.guest('Two');
  let release!: () => void;
  const gate = c.app.rooms.queue.run(c.roomId, () => new Promise<void>((r) => (release = r)));
  await Promise.resolve();
  const a = request(
    one.socket,
    'session:resume',
    resumeRequest(c.owner.resumeToken, { roomId: c.roomId }),
  );
  await waitUntil(
    () =>
      c.app.database.repositories.findSessionById(c.owner.sessionId)!.connectionGeneration === 2,
  );
  const b = request(
    two.socket,
    'session:resume',
    resumeRequest(c.owner.resumeToken, { roomId: c.roomId }),
  );
  await waitUntil(
    () =>
      c.app.database.repositories.findSessionById(c.owner.sessionId)!.connectionGeneration === 3,
  );
  release();
  await gate;
  expect(await a).toMatchObject({ ok: false, code: 'SESSION_TAKEN_OVER', roomId: null });
  expect(await b).toMatchObject({
    ok: true,
    outcome: 'seatRestored',
    participantId: c.ownerParticipantId,
  });
  expect(c.owner.socket.connected).toBe(true);
  c.owner.socket.disconnect();
  await new Promise((r) => setTimeout(r, 20));
  expect(c.app.sessions.registry.getCurrent(c.owner.sessionId)!.socketId).toBe(two.socket.id);
});
it('keeps the existing controller when generation persistence fails before binding', async () => {
  const c = await context(),
    next = await c.guest('Next'),
    old = c.app.sessions.registry.getCurrent(c.owner.sessionId)!;
  c.storage.raw.exec('BEGIN IMMEDIATE');
  try {
    expect(
      await request(
        next.socket,
        'session:resume',
        resumeRequest(c.owner.resumeToken, { roomId: c.roomId }),
      ),
    ).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE', roomId: null });
  } finally {
    c.storage.raw.exec('ROLLBACK');
  }
  expect(c.app.sessions.registry.getCurrent(c.owner.sessionId)).toEqual(old);
});

it.each(recoveryScenario().variants)(
  'LIFE06 restores independent original branch $at',
  async (variant) => {
    const c = await context(),
      f = recoveryScenario();
    expect(c.deadline()).toBe(f.deadline);
    await c.clock.advanceTo(f.disconnectedAt);
    await c.disconnectOwner();
    await c.clock.advanceTo(variant.at);
    const { response } = await c.resumeOwner();
    expect(response).toMatchObject({ ok: true, outcome: 'seatRestored' });
    if (response.ok && response.outcome === 'seatRestored') {
      expect(response.playerView!.self.participantId).toBe(c.ownerParticipantId);
      expect(response.playerView!.self.legalActions.allowed.length > 0).toBe(variant.mayControl);
      expect(Math.max(0, f.deadline - variant.at)).toBe(variant.remainingMs);
      if (!variant.mayControl) expect(c.hand().players[0]!.folded).toBe(true);
    }
  },
);
