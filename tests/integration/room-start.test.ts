import { projectRoomView } from '../../apps/server/src/rooms/room-view.js';
import { projectPublicHand } from '../../apps/server/src/game/public-hand-view.js';
import { projectHandResult } from '../../apps/server/src/game/hand-result.js';
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io-client';
import { createDeck } from '../../packages/poker-core/src/index.js';
import { roomContext } from '../helpers/room-context.js';
import {
  roomStartModes,
  roomStartVariants,
  roomManagementFixture,
} from '../helpers/room-scenarios.js';
import { scenario, record, integer } from '../helpers/fixture-read.js';
const contexts: Awaited<ReturnType<typeof roomContext>>[] = [];
async function context() {
  const c = await roomContext({ handDeck: createDeck, randomInt: () => 0 });
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
type C = Awaited<ReturnType<typeof roomContext>>;
const version = (c: C, roomId: string) => ({
  commandId: randomUUID(),
  roomId,
  expectedRoomVersion: c.readRoom(roomId).row.roomVersion,
});
async function create(c: C, capacity: 2 | 3 | 4 = 4, nickname = 'H0') {
  const host = await c.guest(nickname),
    ack = await c.command(host.socket, 'room:create', {
      commandId: randomUUID(),
      capacity,
      nickname,
    });
  if (!ack.ok) throw new Error(ack.code);
  return { host, roomId: ack.roomId };
}
async function join(c: C, roomId: string, nickname: string) {
  const g = await c.guest(nickname),
    ack = await c.command(g.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(roomId).row.roomCode,
      nickname,
    });
  if (!ack.ok) throw new Error(ack.code);
  return g;
}
async function ready(c: C, roomId: string, socket: Socket) {
  expect((await c.command(socket, 'room:ready', { ...version(c, roomId), ready: true })).ok).toBe(
    true,
  );
}
for (const mode of roomStartModes())
  it(mode.name + ' freezes real humans and explicit bots', async () => {
    const c = await context(),
      { host, roomId } = await create(c, mode.capacity, String(mode.members[0]!.participantId)),
      humans = [host],
      labels = new Map<string, string>();
    labels.set(
      String(mode.members[0]!.participantId),
      c.readRoom(roomId).participants[0]!.participantId,
    );
    for (const m of mode.members.slice(1)) {
      if (m.kind === 'human') {
        const h = await join(c, roomId, String(m.participantId));
        humans.push(h);
        labels.set(
          String(m.participantId),
          c.readRoom(roomId).participants.find((p) => p.sessionId === h.sessionId)!.participantId,
        );
      } else {
        const seatId = integer(m.seatId) as 0 | 1 | 2 | 3;
        expect(
          (
            await c.command(host.socket, 'room:bot:add', {
              ...version(c, roomId),
              seatId,
              difficulty: (mode.difficulty ?? m.difficulty) as 'basic' | 'standard',
            })
          ).ok,
        ).toBe(true);
        labels.set(
          String(m.participantId),
          c.readRoom(roomId).participants.find((p) => p.seatId === seatId && p.leftAt === null)!
            .participantId,
        );
      }
    }
    for (const h of humans) await ready(c, roomId, h.socket);
    const view = projectRoomView(c.readRoom(roomId), c.app.sessions, c.app.sessions.meta());
    expect(view.canStart).toBe(true);
    expect(view.startBlockReasons).toEqual([]);
    expect(view.seats.filter((s) => s.availability === 'open')).toHaveLength(mode.empty);
    const cmd = version(c, roomId),
      ack = await c.command(host.socket, 'room:start', cmd);
    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error(ack.code);
    const hand = c.readRoom(roomId).hand!;
    expect(hand.phase).toBe('preflop');
    expect(hand.players.map((p) => p.participantId)).toEqual(
      mode.frozen.map((label) => labels.get(label)),
    );
    expect(hand.players).toHaveLength(mode.count);
    expect(hand.handVersion).toBe(1);
    expect(hand.initialChipTotal).toBe(mode.count * 2000);
    expect(hand.players.reduce((s, p) => s + p.stack + p.handCommitted, 0)).toBe(mode.count * 2000);
    expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hands').get()?.n).toBe(1);
    const stored = c.storage.raw.prepare('SELECT * FROM hands').get()!;
    expect(stored.hand_version).toBe(1);
    expect(
      JSON.parse(String(stored.starting_stacks_json)).every(
        (p: { stack: number }) => p.stack === 2000,
      ),
    ).toBe(true);
    const holes = c.storage.raw
      .prepare("SELECT owner_participant_id FROM hand_events WHERE kind='holeDealt'")
      .all();
    expect(holes).toHaveLength(mode.count);
    expect(new Set(holes.map((e) => e.owner_participant_id)).size).toBe(mode.count);
    expect(await c.command(host.socket, 'room:start', cmd)).toMatchObject({
      ok: true,
      duplicate: true,
      handId: hand.handId,
    });
    expect(
      await c.command(host.socket, 'room:capacity:set', { ...version(c, roomId), capacity: 4 }),
    ).toMatchObject({ code: 'HAND_IN_PROGRESS' });
    expect(
      await c.command(host.socket, 'room:bot:add', {
        ...version(c, roomId),
        seatId: 3,
        difficulty: 'basic',
      }),
    ).toMatchObject({ code: roomManagementFixture().expected('duringHand').error });
  });
for (const v of roomStartVariants())
  it('ROOM12 ' + v.name + ' readiness and online conditions', async () => {
    const c = await context(),
      { host, roomId } = await create(c, v.capacity),
      humans = [host];
    for (let i = 1; i < v.humans; i++) humans.push(await join(c, roomId, 'H' + i));
    const before = c.readRoom(roomId);
    c.storage.raw.prepare("UPDATE rooms SET status='betweenHands' WHERE room_id=?").run(roomId);
    c.app.rooms.store.replace({ ...before, row: { ...before.row, status: 'betweenHands' } });
    for (const h of humans.slice(0, v.ready)) await ready(c, roomId, h.socket);
    for (const h of humans.slice(v.online)) h.socket.disconnect();
    if (v.online < v.humans)
      await expect
        .poll(() => c.readRoom(roomId).row.roomVersion)
        .toBeGreaterThan(before.row.roomVersion + v.ready);
    const ack = await c.command(host.socket, 'room:start', version(c, roomId));
    expect(ack.ok).toBe(v.expected.canStart);
    if (!ack.ok) expect(ack.code).toBe(v.expected.error);
  });
it('ROOM10 rejects one human without autofill and ROOM13 rejects non-host', async () => {
  const c = await context(),
    { host, roomId } = await create(c);
  await ready(c, roomId, host.socket);
  expect(await c.command(host.socket, 'room:start', version(c, roomId))).toMatchObject({
    code: scenario('ROOM10', ['evaluateStart']).expected.error,
  });
  const b = await join(c, roomId, 'B');
  await ready(c, roomId, host.socket);
  await ready(c, roomId, b.socket);
  expect(await c.command(b.socket, 'room:start', version(c, roomId))).toMatchObject({
    code: scenario('ROOM13', ['startRoom']).expected.error,
  });
  expect(c.readRoom(roomId).hand).toBeNull();
});
it('LIFE11 clears readiness on real changes, preserves sparse seats and cashouts 1750', async () => {
  const f = roomManagementFixture(),
    removeStack = integer(record(f.given('removeBot').existingBot).stack);
  const c = await context(),
    { host, roomId } = await create(c);
  for (const seatId of [1, 2] as const)
    expect(
      (
        await c.command(host.socket, 'room:bot:add', {
          ...version(c, roomId),
          seatId,
          difficulty: 'standard',
        })
      ).ok,
    ).toBe(true);
  const b = await join(c, roomId, 'B');
  for (const seatId of [1, 2] as const)
    expect(
      (await c.command(host.socket, 'room:bot:remove', { ...version(c, roomId), seatId })).ok,
    ).toBe(true);
  await ready(c, roomId, host.socket);
  await ready(c, roomId, b.socket);
  const before = c.readRoom(roomId);
  expect(
    await c.command(host.socket, 'room:ready', { ...version(c, roomId), ready: true }),
  ).toMatchObject({ ok: true, appliedRoomVersion: before.row.roomVersion });
  expect(
    (await c.command(host.socket, 'room:capacity:set', { ...version(c, roomId), capacity: 2 })).ok,
  ).toBe(true);
  expect(
    c
      .readRoom(roomId)
      .participants.filter((p) => p.leftAt === null)
      .map((p) => p.seatId),
  ).toEqual(f.expected('capacity2').occupiedSeatIds);
  expect(
    c
      .readRoom(roomId)
      .participants.filter((p) => p.leftAt === null)
      .every((p) => !p.ready),
  ).toBe(true);
  expect(
    await c.command(b.socket, 'room:bot:add', {
      ...version(c, roomId),
      seatId: 1,
      difficulty: 'basic',
    }),
  ).toMatchObject({ code: 'NOT_HOST' });
  await c.command(host.socket, 'room:capacity:set', { ...version(c, roomId), capacity: 4 });
  await ready(c, roomId, host.socket);
  expect(
    (
      await c.command(host.socket, 'room:bot:add', {
        ...version(c, roomId),
        seatId: 1,
        difficulty: 'basic',
      })
    ).ok,
  ).toBe(true);
  expect(
    c
      .readRoom(roomId)
      .participants.filter((p) => p.leftAt === null)
      .every((p) => !p.ready),
  ).toBe(true);
  expect(
    await c.command(host.socket, 'room:capacity:set', { ...version(c, roomId), capacity: 2 }),
  ).toMatchObject({ code: 'INVALID_INPUT' });
  const state = c.readRoom(roomId),
    bot = state.participants.find((p) => p.leftAt === null && p.botId !== null)!;
  c.storage.raw
    .prepare('UPDATE participants SET stack=? WHERE participant_id=?')
    .run(removeStack, bot.participantId);
  c.app.rooms.store.replace({
    ...state,
    participants: state.participants.map((p) =>
      p.participantId === bot.participantId ? { ...p, stack: removeStack } : p,
    ),
  });
  const remove = version(c, roomId);
  expect((await c.command(host.socket, 'room:bot:remove', { ...remove, seatId: 1 })).ok).toBe(true);
  expect(
    c.storage.db.repositories
      .listLedger(roomId)
      .find((e) => e.sourceCommandId === remove.commandId),
  ).toMatchObject({
    type: f.expected('removeBot').ledgerType,
    delta: f.expected('removeBot').ledgerDelta,
  });
});
it('LIFE10 does not fund proposal and resets consenting identities with one atomic new hand', async () => {
  const raw = scenario('LIFE10', ['finishProposeResetThenAgreeAndStart']),
    c = await context(),
    { host, roomId } = await create(c, 3, 'C'),
    a = await join(c, roomId, 'A'),
    b = await join(c, roomId, 'B'),
    base = c.readRoom(roomId),
    stocks = record(raw.given.stacks);
  const participants = base.participants.map((p) => ({
    ...p,
    stack: integer(stocks[p.nickname]),
    admission: integer(stocks[p.nickname]) === 0 ? ('eliminated' as const) : ('active' as const),
  }));
  for (const p of participants)
    c.storage.raw
      .prepare('UPDATE participants SET stack=?,admission=? WHERE participant_id=?')
      .run(p.stack, p.admission, p.participantId);
  c.storage.raw
    .prepare("UPDATE matches SET status='finished',ended_at=? WHERE match_id=?")
    .run(c.clock.now, base.match.matchId);
  c.storage.raw.prepare("UPDATE rooms SET status='matchFinished' WHERE room_id=?").run(roomId);
  c.app.rooms.store.replace({
    ...base,
    row: { ...base.row, status: 'matchFinished' },
    participants,
    match: { ...base.match, status: 'finished', endedAt: c.clock.now },
  });
  expect((await c.command(host.socket, 'room:reset:propose', version(c, roomId))).ok).toBe(true);
  expect(c.readRoom(roomId).participants.map((p) => p.stack)).toEqual(
    participants.map((p) => p.stack),
  );
  await ready(c, roomId, a.socket);
  await ready(c, roomId, host.socket);
  expect(await c.command(host.socket, 'room:start', version(c, roomId))).toMatchObject({
    code: 'NOT_READY',
  });
  await ready(c, roomId, b.socket);
  const start = version(c, roomId);
  expect((await c.command(host.socket, 'room:start', start)).ok).toBe(true);
  const state = c.readRoom(roomId);
  expect(state.match.matchId).not.toBe(base.match.matchId);
  expect(state.participants.map((p) => p.participantId)).toEqual(
    base.participants.map((p) => p.participantId),
  );
  expect(state.hand!.players.every((p) => p.startingStack === 2000)).toBe(true);
  const ledger = c.storage.db.repositories
    .listLedger(roomId)
    .filter((e) => e.sourceCommandId === start.commandId);
  expect(ledger).toHaveLength(4);
  expect(ledger.map((e) => e.delta).sort((a, b) => a - b)).toEqual([-6000, 2000, 2000, 2000]);
  expect(ledger.reduce((n, e) => n + e.delta, 0)).toBe(0);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM matches').get()?.n).toBe(2);
});
it('cancels consent and rejects stale management without touching money', async () => {
  const c = await context(),
    { host, roomId } = await create(c),
    b = await join(c, roomId, 'B');
  await c.command(host.socket, 'room:reset:propose', version(c, roomId));
  await ready(c, roomId, b.socket);
  expect((await c.command(host.socket, 'room:reset:cancel', version(c, roomId))).ok).toBe(true);
  expect(c.readRoom(roomId).row.resetProposal).toBeNull();
  expect(c.readRoom(roomId).participants.every((p) => !p.ready)).toBe(true);
  const current = c.readRoom(roomId);
  expect(
    await c.command(host.socket, 'room:ready', {
      ...version(c, roomId),
      expectedRoomVersion: 0,
      ready: true,
    }),
  ).toMatchObject({ code: 'STALE_STATE' });
  expect(c.readRoom(roomId)).toBe(current);
});
it('a real write lock leaves hand-start readiness and balances unchanged', async () => {
  const c = await context(),
    { host, roomId } = await create(c, 2),
    b = await join(c, roomId, 'B');
  await ready(c, roomId, host.socket);
  await ready(c, roomId, b.socket);
  const before = c.readRoom(roomId);
  c.storage.raw.exec('BEGIN IMMEDIATE');
  try {
    expect(await c.command(host.socket, 'room:start', version(c, roomId))).toMatchObject({
      code: 'PERSISTENCE_UNAVAILABLE',
    });
  } finally {
    c.storage.raw.exec('ROLLBACK');
  }
  expect(c.readRoom(roomId).hand).toBeNull();
  expect(c.readRoom(roomId).participants).toEqual(before.participants);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hands').get()?.n).toBe(0);
  expect(c.storage.raw.prepare('SELECT status FROM rooms').get()?.status).toBe('waiting');
});
it('persists an automatic short-blind settlement with burn counts only', async () => {
  const c = await context(),
    { host, roomId } = await create(c, 2),
    b = await join(c, roomId, 'B');
  await ready(c, roomId, host.socket);
  await ready(c, roomId, b.socket);
  const before = c.readRoom(roomId),
    participants = before.participants.map((p, i) => ({ ...p, stack: i === 0 ? 5 : 7 }));
  for (const p of participants)
    c.storage.raw
      .prepare('UPDATE participants SET stack=? WHERE participant_id=?')
      .run(p.stack, p.participantId);
  c.app.rooms.store.replace({ ...before, participants });
  expect((await c.command(host.socket, 'room:start', version(c, roomId))).ok).toBe(true);
  expect(c.readRoom(roomId).hand!.phase).toBe('settled');
  const publicState = projectPublicHand(c.readRoom(roomId))!;
  expect(publicState.pots).toEqual([]);
  expect(publicState.potTotal).toBe(0);
  expect(
    projectHandResult(c.readRoom(roomId).hand!, roomId, c.readRoom(roomId).match.matchId).pots
      .length,
  ).toBeGreaterThan(0);
  const row = c.storage.raw.prepare('SELECT * FROM hands').get()!;
  expect(row.status).toBe('settled');
  expect(JSON.parse(String(row.result_json)).phase).toBe('settled');
  const burns = c.storage.raw
    .prepare("SELECT payload_json FROM hand_events WHERE kind='cardBurned'")
    .all();
  expect(burns).toHaveLength(3);
  expect(
    burns.every((e) => JSON.stringify(JSON.parse(String(e.payload_json))) === '{"count":1}'),
  ).toBe(true);
});

it('creates only one hand when different start commands compete', async () => {
  const c = await context(),
    { host, roomId } = await create(c, 2),
    b = await join(c, roomId, 'B');
  await ready(c, roomId, host.socket);
  await ready(c, roomId, b.socket);
  const base = version(c, roomId);
  const results = await Promise.all([
    c.command(host.socket, 'room:start', base),
    c.command(host.socket, 'room:start', { ...base, commandId: randomUUID() }),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok && r.code === 'HAND_IN_PROGRESS')).toHaveLength(1);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hands').get()?.n).toBe(1);
});
