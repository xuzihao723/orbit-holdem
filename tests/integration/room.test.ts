import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { roomContext } from '../helpers/room-context.js';
import { roomJoinVariants } from '../helpers/room-scenarios.js';
import { createDeck, createHand } from '../../packages/poker-core/src/index.js';
const contexts: Awaited<ReturnType<typeof roomContext>>[] = [];
async function context(...args: Parameters<typeof roomContext>) {
  const c = await roomContext(...args);
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it.each([2, 3, 4] as const)(
  'creates a durable capacity %i room, initial match, host and one grant',
  async (capacity) => {
    const c = await context(),
      a = await c.guest(),
      views: unknown[] = [];
    a.socket.on('room:view', (v) => views.push(v));
    const ack = await c.command(a.socket, 'room:create', {
      commandId: randomUUID(),
      capacity,
      nickname: 'A',
    });
    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error(ack.code);
    const state = c.readRoom(ack.roomId);
    expect(state.row.capacity).toBe(capacity);
    expect(state.participants).toHaveLength(1);
    expect(state.participants[0]).toMatchObject({
      sessionId: a.sessionId,
      seatId: 0,
      stack: 2000,
      admission: 'active',
    });
    expect(state.row.hostParticipantId).toBe(state.participants[0]!.participantId);
    expect(c.storage.db.repositories.listLedger(ack.roomId)).toMatchObject([
      { type: 'seat_grant', delta: 2000 },
    ]);
    expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM matches').get()?.n).toBe(1);
    await expect.poll(() => views.length).toBe(1);
    const serialized = JSON.stringify(views);
    for (const secret of [a.sessionId, a.resumeToken, 'tokenHash', 'deck'])
      expect(serialized).not.toContain(secret);
  },
);
for (const v of roomJoinVariants())
  it('ROOM11 ' + v.name + ' uses real sessions and atomic seat assignment', async () => {
    const c = await context(),
      a = await c.guest(),
      created = await c.command(a.socket, 'room:create', {
        commandId: randomUUID(),
        capacity: v.capacity,
        nickname: 'A',
      });
    if (!created.ok) throw new Error(created.code);
    const code = c.readRoom(created.roomId).row.roomCode;
    for (let i = 1; i < v.occupiedSeats.length; i++) {
      const g = await c.guest('P' + i);
      expect(
        (
          await c.command(g.socket, 'room:join', {
            commandId: randomUUID(),
            roomCode: code,
            nickname: 'P' + i,
          })
        ).ok,
      ).toBe(true);
    }
    const entrants = await Promise.all(
        Array.from({ length: v.requests }, (_, i) => c.guest('E' + i)),
      ),
      before = c.readRoom(created.roomId).hand;
    const results = await Promise.all(
      entrants.map((g) =>
        c.command(g.socket, 'room:join', {
          commandId: randomUUID(),
          roomCode: code,
          nickname: 'E',
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(v.successes);
    expect(results.filter((r) => !r.ok && r.code === 'ROOM_FULL')).toHaveLength(
      v.requests - v.successes,
    );
    const state = c.readRoom(created.roomId),
      seats = state.participants
        .filter((p) => p.leftAt === null)
        .map((p) => p.seatId)
        .sort();
    expect(seats).toEqual(v.occupiedAfter);
    expect(new Set(seats).size).toBe(seats.length);
    expect(state.hand).toBe(before);
  });
it('persists create/join once across ten concurrent duplicate packets and rejects changed intent', async () => {
  const c = await context(),
    a = await c.guest(),
    cmd = { commandId: randomUUID(), capacity: 4 as const, nickname: 'A' },
    acks = await c.burst(a.socket, 'room:create', cmd, 10);
  expect(acks.filter((a) => a.ok && !a.duplicate)).toHaveLength(1);
  expect(acks.filter((a) => a.duplicate)).toHaveLength(9);
  const first = acks[0]!;
  if (!first.ok) throw new Error(first.code);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM rooms').get()?.n).toBe(1);
  expect(await c.command(a.socket, 'room:create', { ...cmd, capacity: 2 })).toMatchObject({
    code: 'COMMAND_ID_CONFLICT',
  });
  const b = await c.guest('B'),
    join = {
      commandId: randomUUID(),
      roomCode: c.readRoom(first.roomId).row.roomCode,
      nickname: 'B',
    },
    joined = await c.burst(b.socket, 'room:join', join, 10);
  expect(joined.filter((a) => a.ok && !a.duplicate)).toHaveLength(1);
  expect(joined.filter((a) => a.duplicate)).toHaveLength(9);
  const before = c.readRoom(first.roomId);
  expect(
    await c.command(b.socket, 'room:join', { ...join, commandId: randomUUID() }),
  ).toMatchObject({ ok: true, appliedRoomVersion: before.row.roomVersion });
  expect(c.storage.db.repositories.listLedger(first.roomId)).toHaveLength(2);
  expect(c.readRoom(first.roomId).participants).toHaveLength(2);
});
it('cashouts on waiting leave and creates a fresh participant on rejoin while retaining old receipt', async () => {
  const c = await context(),
    a = await c.guest(),
    b = await c.guest('B'),
    created = await c.command(a.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 2,
      nickname: 'A',
    });
  if (!created.ok) throw new Error(created.code);
  const code = c.readRoom(created.roomId).row.roomCode;
  await c.command(b.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: code,
    nickname: 'B',
  });
  const pid = c
    .readRoom(created.roomId)
    .participants.find((p) => p.sessionId === b.sessionId)!.participantId;
  const leave = { commandId: randomUUID(), roomId: created.roomId };
  expect(await c.command(b.socket, 'room:leave', leave)).toMatchObject({ ok: true });
  expect(await c.command(b.socket, 'room:leave', leave)).toMatchObject({
    ok: true,
    duplicate: true,
  });
  expect(
    await c.command(b.socket, 'room:leave', { ...leave, commandId: randomUUID() }),
  ).toMatchObject({ code: 'ROOM_FORBIDDEN', roomId: null });
  await c.command(b.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: code,
    nickname: 'B',
  });
  const state = c.readRoom(created.roomId),
    current = state.participants.find((p) => p.sessionId === b.sessionId && p.leftAt === null)!;
  expect(current.participantId).not.toBe(pid);
  expect(current.stack).toBe(2000);
  expect(state.participants.find((p) => p.participantId === pid)!.leftAt).not.toBeNull();
  expect(
    c.storage.db.repositories
      .listLedger(created.roomId)
      .map((x) => x.delta)
      .sort((a, b) => a - b),
  ).toEqual([-2000, 2000, 2000, 2000]);
});
it('rolls back a locked join without changing committed membership or acknowledging success', async () => {
  const c = await context(),
    a = await c.guest(),
    b = await c.guest('B'),
    created = await c.command(a.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 2,
      nickname: 'A',
    });
  if (!created.ok) throw new Error(created.code);
  const before = c.readRoom(created.roomId);
  c.storage.raw.exec('BEGIN IMMEDIATE');
  try {
    expect(
      await c.command(b.socket, 'room:join', {
        commandId: randomUUID(),
        roomCode: before.row.roomCode,
        nickname: 'B',
      }),
    ).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
  } finally {
    c.storage.raw.exec('ROLLBACK');
  }
  expect(c.readRoom(created.roomId).participants).toEqual(before.participants);
  expect(c.readRoom(created.roomId).row.status).toBe('pausedFault');
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM participants').get()?.n).toBe(1);
  expect(c.storage.db.repositories.listLedger(created.roomId)).toHaveLength(1);
});
it('bounds room-code collision retries without treating other failures as collisions', async () => {
  let calls = 0;
  const c = await context({
      roomCode: () => {
        calls++;
        return 'ABC234';
      },
    }),
    a = await c.guest(),
    b = await c.guest('B');
  expect(
    (
      await c.command(a.socket, 'room:create', {
        commandId: randomUUID(),
        capacity: 2,
        nickname: 'A',
      })
    ).ok,
  ).toBe(true);
  expect(
    await c.command(b.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 2,
      nickname: 'B',
    }),
  ).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
  expect(calls).toBe(11);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM rooms').get()?.n).toBe(1);
});
it('joins a real active hand only as waitingNextHand without granting or changing the hand', async () => {
  const c = await context(),
    a = await c.guest(),
    b = await c.guest('B'),
    d = await c.guest('C'),
    created = await c.command(a.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 3,
      nickname: 'A',
    });
  if (!created.ok) throw new Error(created.code);
  const original = c.readRoom(created.roomId);
  await c.command(b.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: original.row.roomCode,
    nickname: 'B',
  });
  const room = c.readRoom(created.roomId),
    handId = randomUUID(),
    made = createHand({
      handId,
      dealerSeatId: 0,
      deck: createDeck(),
      players: room.participants.map((p) => ({
        seatId: p.seatId,
        participantId: p.participantId,
        stack: p.stack,
      })),
    }),
    hand = made.state;
  c.storage.raw
    .prepare('INSERT INTO hands VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(
      handId,
      room.row.roomId,
      room.match.matchId,
      'room-boot',
      1,
      'active',
      JSON.stringify(room.participants.map((p) => p.participantId)),
      JSON.stringify(
        room.participants.map((p) => ({ participantId: p.participantId, stack: p.stack })),
      ),
      JSON.stringify(hand.positions),
      4000,
      null,
      1000,
      null,
    );
  c.storage.raw
    .prepare('UPDATE rooms SET status=?,current_hand_id=?,room_version=? WHERE room_id=?')
    .run('playing', handId, room.row.roomVersion + 1, room.row.roomId);
  const participants = room.participants.map((p) => ({
    ...p,
    stack: hand.players.find((x) => x.participantId === p.participantId)!.stack,
  }));
  for (const p of participants)
    c.storage.raw
      .prepare('UPDATE participants SET stack=? WHERE participant_id=?')
      .run(p.stack, p.participantId);
  c.app.rooms.store.replace({
    ...room,
    row: {
      ...room.row,
      status: 'playing',
      currentHandId: handId,
      roomVersion: room.row.roomVersion + 1,
    },
    participants,
    hand,
  });
  expect(
    (
      await c.command(d.socket, 'room:join', {
        commandId: randomUUID(),
        roomCode: room.row.roomCode,
        nickname: 'C',
      })
    ).ok,
  ).toBe(true);
  const after = c.readRoom(room.row.roomId);
  expect(after.hand).toBe(hand);
  expect(after.participants.find((p) => p.sessionId === d.sessionId)).toMatchObject({
    stack: 0,
    admission: 'waitingNextHand',
  });
  expect(c.storage.db.repositories.listLedger(room.row.roomId)).toHaveLength(2);
});

it('pauses within the room FIFO before another identity can commit after an IO failure', async () => {
  const c = await context(),
    a = await c.guest(),
    b = await c.guest('B'),
    d = await c.guest('D'),
    created = await c.command(a.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 3,
      nickname: 'A',
    });
  if (!created.ok) throw new Error(created.code);
  const code = c.readRoom(created.roomId).row.roomCode,
    real = c.app.database.rooms.commitRoomChange.bind(c.app.database.rooms);
  let failed = false;
  c.app.database.rooms.commitRoomChange = (batch) => {
    if (!failed) {
      failed = true;
      throw new Error('IO_FAIL');
    }
    real(batch);
  };
  let release!: () => void;
  const gate = c.app.rooms.queue.run(created.roomId, () => new Promise<void>((r) => (release = r)));
  await Promise.resolve();
  const commands = [b, d].map((g) =>
    c.app.rooms.execute({
      event: 'room:join',
      payload: { commandId: randomUUID(), roomCode: code, nickname: g === b ? 'B' : 'D' },
      control: c.app.sessions.registry.getBySocket(g.socket.id!)!,
      receivedAt: c.clock.now,
    }),
  );
  await Promise.resolve();
  release();
  await gate;
  const results = await Promise.all(commands);
  expect(results.map((r) => (r.ok ? 'SUCCESS' : r.code))).toEqual([
    'PERSISTENCE_UNAVAILABLE',
    'ROOM_PAUSED',
  ]);
  expect(c.readRoom(created.roomId).participants).toHaveLength(1);
  expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM participants').get()?.n).toBe(1);
});
it('retains an unknown-code business rejection even after that code is created', async () => {
  const c = await context({ roomCode: () => 'ABC234' }),
    a = await c.guest(),
    b = await c.guest('B'),
    join = { commandId: randomUUID(), roomCode: 'ABC234', nickname: 'B' };
  expect(await c.command(b.socket, 'room:join', join)).toMatchObject({
    ok: false,
    code: 'ROOM_NOT_FOUND',
  });
  expect(
    c.storage.db.repositories.findReceipt('session:' + b.sessionId, join.commandId),
  ).not.toBeNull();
  expect(
    (
      await c.command(a.socket, 'room:create', {
        commandId: randomUUID(),
        capacity: 2,
        nickname: 'A',
      })
    ).ok,
  ).toBe(true);
  expect(await c.command(b.socket, 'room:join', join)).toMatchObject({
    ok: false,
    code: 'ROOM_NOT_FOUND',
    duplicate: true,
  });
});
it('publishes disconnect presence with a durable room version without clearing a new controller', async () => {
  const c = await context(),
    a = await c.guest(),
    b = await c.guest('B'),
    created = await c.command(a.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 2,
      nickname: 'A',
    });
  if (!created.ok) throw new Error(created.code);
  await c.command(b.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(created.roomId).row.roomCode,
    nickname: 'B',
  });
  const before = c.readRoom(created.roomId).row.roomVersion;
  const views: import('@orbit/protocol').RoomView[] = [];
  a.socket.on('room:view', (v) => views.push(v));
  b.socket.disconnect();
  await expect.poll(() => c.readRoom(created.roomId).row.roomVersion).toBe(before + 1);
  expect(c.app.database.rooms.readRoom(created.roomId)!.room.roomVersion).toBe(before + 1);
  await expect
    .poll(() =>
      views.some((v) =>
        v.seats.some(
          (s) => s.occupant?.nickname === 'B' && s.occupant.kind === 'human' && !s.occupant.online,
        ),
      ),
    )
    .toBe(true);
});

it('rejects immutable nickname changes and per-participant transfers without matching ledger', async () => {
  const c = await context(),
    a = await c.guest(),
    b = await c.guest('B'),
    created = await c.command(a.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 2,
      nickname: 'A',
    });
  if (!created.ok) throw new Error(created.code);
  await c.command(b.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(created.roomId).row.roomCode,
    nickname: 'B',
  });
  const state = c.readRoom(created.roomId);
  const batch = (participants: typeof state.participants) => {
    const commandId = randomUUID();
    return {
      expectedRoomVersion: state.row.roomVersion,
      room: { ...state.row, roomVersion: state.row.roomVersion + 1 },
      participantWrites: participants,
      matchWrites: [state.match],
      ledger: [],
      receipt: {
        actorScope: 'session:' + a.sessionId,
        commandId,
        payloadHash: 'a'.repeat(64),
        event: 'room:ready',
        result: { ...created, commandId, appliedRoomVersion: state.row.roomVersion + 1 },
        roomId: state.row.roomId,
        appliedRoomVersion: state.row.roomVersion + 1,
        handId: null,
        appliedHandVersion: null,
        createdAt: 1000,
      },
    };
  };
  expect(() =>
    c.app.database.rooms.commitRoomChange(
      batch(state.participants.map((p, i) => (i === 0 ? { ...p, nickname: 'Renamed' } : p))),
    ),
  ).toThrow();
  expect(() =>
    c.app.database.rooms.commitRoomChange(
      batch(state.participants.map((p, i) => ({ ...p, stack: p.stack + (i === 0 ? -1 : 1) }))),
    ),
  ).toThrow();
  expect(c.app.database.rooms.readRoom(state.row.roomId)!.room.roomVersion).toBe(
    state.row.roomVersion,
  );
});

it('never sends presence snapshots to a still-connected expired controller', async () => {
  const c = await context(),
    a = await c.guest(),
    created = await c.command(a.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 2,
      nickname: 'A',
    });
  if (!created.ok) throw new Error(created.code);
  c.clock.now += 10;
  const allViews: import('@orbit/protocol').RoomView[] = [];
  a.socket.on('room:view', (v) => allViews.push(v));
  const b = await c.guest('B');
  await c.command(b.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(created.roomId).row.roomCode,
    nickname: 'B',
  });
  await expect
    .poll(() => allViews.some((v) => v.roomVersion === c.readRoom(created.roomId).row.roomVersion))
    .toBe(true);
  c.clock.now = a.expiresAt;
  const seen: unknown[] = [];
  a.socket.on('room:view', (v) => seen.push(v));
  const version = c.readRoom(created.roomId).row.roomVersion;
  b.socket.disconnect();
  await expect.poll(() => c.readRoom(created.roomId).row.roomVersion).toBe(version + 1);
  await new Promise<void>((r) => setTimeout(r, 20));
  expect(a.socket.connected).toBe(true);
  expect(seen).toEqual([]);
});

it('keeps a borrowed database usable after application shutdown', async () => {
  const c = await context();
  await c.app.close();
  expect(c.storage.db.repositories.findSessionById('missing')).toBeNull();
  await c.app.close();
});

it('passes host to the earliest valid online member rather than an expired bound socket', async () => {
  const c = await context(),
    expired = await c.guest('Old');
  c.clock.now += 10;
  const host = await c.guest('Host'),
    created = await c.command(host.socket, 'room:create', {
      commandId: randomUUID(),
      capacity: 3,
      nickname: 'Host',
    });
  if (!created.ok) throw new Error(created.code);
  const code = c.readRoom(created.roomId).row.roomCode;
  await c.command(expired.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: code,
    nickname: 'Old',
  });
  c.clock.now += 10;
  const valid = await c.guest('Valid');
  await c.command(valid.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: code,
    nickname: 'Valid',
  });
  c.clock.now = expired.expiresAt;
  expect(
    (
      await c.command(host.socket, 'room:leave', {
        commandId: randomUUID(),
        roomId: created.roomId,
      })
    ).ok,
  ).toBe(true);
  const state = c.readRoom(created.roomId);
  expect(state.row.hostParticipantId).toBe(
    state.participants.find((p) => p.sessionId === valid.sessionId)!.participantId,
  );
});
