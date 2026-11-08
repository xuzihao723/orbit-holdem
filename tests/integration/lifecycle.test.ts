import { lifecycleContext, trustedLifecycleAction } from '../helpers/lifecycle-context.js';
import { request, resumeRequest } from '../helpers/session-context.js';
import { projectPlayerView } from '../../apps/server/src/game/player-view.js';
import {
  allInLeaveScenario,
  lifecycleScenario,
  partialLeaveScenario,
} from '../helpers/lifecycle-scenarios.js';
import { applyBettingAction } from '../../packages/poker-core/src/index.js';
import { chooseHost } from '../../apps/server/src/rooms/hand-boundary.js';
import { array, text } from '../helpers/fixture-read.js';
import { integer, record, seats } from '../helpers/fixture-read.js';
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { timerContext } from '../helpers/timer-context.js';
import { waitUntil } from '../helpers/reconnect-context.js';
const contexts: Awaited<ReturnType<typeof timerContext>>[] = [];
import { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import { memoryCredentialStore } from '../../apps/web/src/network/credential-store.js';
it('publishes a strictly newer recovery version that releases a real client from boundary pausedFault', async () => {
  const c = await context(),
    w = await c.guest('Waiting');
  await c.command(w.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(c.roomId).row.roomCode,
    nickname: 'Waiting',
  });
  const credentials = memoryCredentialStore();
  credentials.write({ sessionId: w.sessionId, resumeToken: w.resumeToken, expiresAt: w.expiresAt });
  const client = createSocketClient({ url: c.origin, credentials });
  try {
    await client.connect();
    expect(await client.resume()).toMatchObject({ ok: true, outcome: 'seatRestored' });
    c.storage.raw.exec(
      "CREATE TRIGGER fail_live_boundary BEFORE INSERT ON chip_ledger WHEN NEW.type='seat_grant' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    await c.play({ type: 'fold' });
    await waitUntil(() => client.store.snapshot.roomView?.status === 'pausedFault');
    const faultVersion = client.store.snapshot.roomView!.roomVersion;
    c.humans[1]!.socket.disconnect();
    await waitUntil(() => !c.app.sessions.registry.getCurrent(c.humans[1]!.sessionId));
    await c.app.rooms.queue.idle();
    c.storage.raw.exec('DROP TRIGGER fail_live_boundary');
    expect(await c.app.rooms.executeBoundary(c.roomId)).toBe('applied');
    await waitUntil(() => client.store.snapshot.roomView?.status === 'betweenHands');
    expect(client.store.snapshot.roomView!.roomVersion).toBeGreaterThan(faultVersion);
    expect(client.store.snapshot.playerView).toMatchObject({
      phase: 'settled',
      self: { admission: 'active' },
    });
  } finally {
    client.close();
  }
});
it('LIFE08 host selection uses exact joined times, excludes bots, and retains the original reservation at 119 seconds', async () => {
  const f = lifecycleScenario('LIFE08'),
    c = await lifecycleContext({ players: 3, bots: 1 });
  try {
    const rows = array(f.given.members).map(record),
      state = c.room(),
      participants = state.participants.map((p, i) => ({
        ...p,
        joinedAt: integer(rows[i]!.joinedAt),
      })),
      host = participants[0]!.participantId;
    c.humans[0]!.socket.disconnect();
    await waitUntil(() => !c.app.sessions.registry.getCurrent(c.humans[0]!.sessionId));
    await c.clock.advanceTo(119000, false);
    expect(
      chooseHost(
        { ...state, participants, row: { ...state.row, hostParticipantId: host } },
        c.app.sessions,
      ),
    ).toBe(host);
    await c.clock.advanceTo(120000, false);
    const selected = chooseHost(
      { ...state, participants, row: { ...state.row, hostParticipantId: host } },
      c.app.sessions,
    );
    expect(participants.findIndex((p) => p.participantId === selected)).toBe(
      rows.findIndex((p) => text(p.id) === text(f.expected.hostAt120000)),
    );
  } finally {
    await c.close();
  }
});
it('LIFE12 reaches real handVersion 12 and preserves stack 1980 when a 20 bet commit fails', async () => {
  const f = lifecycleScenario('LIFE12'),
    failure = record(array(f.given.variants)[0]),
    expected = record(f.expected.writeFailure),
    c = await context({ players: 3 });
  while (c.hand().handVersion < integer(failure.handVersion)) {
    const h = c.hand(),
      p = h.players.find((p) => p.seatId === h.betting!.actorSeatId)!;
    expect(
      await c.play({ type: p.streetCommitted < h.betting!.currentBet ? 'call' : 'check' }),
    ).toMatchObject({ ok: true });
  }
  const who = c.actor(),
    member = c.readRoom(c.roomId).participants.find((p) => p.sessionId === who.sessionId)!;
  expect(member.stack).toBe(integer(failure.stack));
  c.storage.raw.exec(
    "CREATE TRIGGER fail_life12 BEFORE INSERT ON command_receipts WHEN NEW.event='game:action' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  expect(
    await c.play({
      type: 'bet',
      raiseTo: integer(failure.stack) - integer(failure.candidateStack),
    }),
  ).toMatchObject({ ok: expected.ackOk });
  expect(c.hand().handVersion).toBe(integer(expected.handVersion));
  expect(
    c.readRoom(c.roomId).participants.find((p) => p.participantId === member.participantId)!.stack,
  ).toBe(integer(expected.stack));
  expect(c.readRoom(c.roomId).row.status).toBe(expected.status);
});
it('rolls back the leaving marker and fold together when the human leave receipt is rejected', async () => {
  const c = await context(),
    before = c.hand(),
    old = c.readRoom(c.roomId).participants;
  c.storage.raw.exec(
    "CREATE TRIGGER fail_leave BEFORE INSERT ON command_receipts WHEN NEW.event='room:leave' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  expect(
    await c.command(c.actor().socket, 'room:leave', { commandId: randomUUID(), roomId: c.roomId }),
  ).toMatchObject({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
  expect(c.hand()).toBe(before);
  expect(c.readRoom(c.roomId).participants).toEqual(old);
  expect(c.app.database.hands.readHand(before.handId)!.status).toBe('active');
  expect(
    c.storage.raw.prepare("SELECT COUNT(*) n FROM chip_ledger WHERE type='seat_cashout'").get()?.n,
  ).toBe(0);
});
it('pauses an expiry SQL failure without changing the last committed seat balance or recording cashout', async () => {
  const c = await context();
  await c.play({ type: 'fold' });
  const h = c.humans[0]!,
    stack = c.readRoom(c.roomId).participants[0]!.stack;
  h.socket.disconnect();
  await waitUntil(() => !c.app.sessions.registry.getCurrent(h.sessionId));
  c.storage.raw.exec(
    "CREATE TRIGGER fail_expiry BEFORE INSERT ON command_receipts WHEN NEW.event='internal:expiry' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  await c.clock.advanceTo(120000);
  expect(c.readRoom(c.roomId).row.status).toBe('pausedFault');
  expect(c.readRoom(c.roomId).participants[0]).toMatchObject({ stack, leftAt: null });
  expect(
    c.storage.raw.prepare("SELECT COUNT(*) n FROM chip_ledger WHERE type='seat_cashout'").get()?.n,
  ).toBe(0);
});
async function context(input: Parameters<typeof timerContext>[0] = {}) {
  const c = await timerContext(input);
  contexts.push(c);
  return c;
}
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it('atomically folds an exiting actor and cashes out only its terminal stack at the boundary', async () => {
  const c = await context(),
    who = c.actor(),
    pid = c.hand().players.find((p) => p.seatId === 0)!.participantId,
    id = randomUUID();
  expect(
    await c.command(who.socket, 'room:leave', { commandId: id, roomId: c.roomId }),
  ).toMatchObject({ ok: true });
  await c.app.rooms.queue.idle();
  expect(c.hand().phase).toBe('settled');
  expect(c.hand().players[0]!.folded).toBe(true);
  const p = c.readRoom(c.roomId).participants.find((p) => p.participantId === pid)!;
  expect(p).toMatchObject({ stack: 0, admission: 'leaving', leftAt: 0 });
  expect(
    c.storage.db.repositories
      .listLedger(c.roomId)
      .filter((e) => e.participantId === pid && e.type === 'seat_cashout')
      .map((e) => e.delta),
  ).toEqual([-1990]);
  expect(
    c.app.database.hands
      .readHand(c.hand().handId)!
      .result!.finalStacks.find((p) => p.participantId === pid)!.stack,
  ).toBe(1990);
  expect(
    await c.command(who.socket, 'room:leave', { commandId: id, roomId: c.roomId }),
  ).toMatchObject({ ok: true, duplicate: true });
});
it('keeps a nonactor exit out of the current hand version and deadline then folds when its turn arrives', async () => {
  const c = await context({ players: 3 }),
    before = c.hand(),
    deadline = c.deadline(),
    who = c.humans[1]!;
  expect(c.actor().sessionId).not.toBe(who.sessionId);
  expect(
    await c.command(who.socket, 'room:leave', { commandId: randomUUID(), roomId: c.roomId }),
  ).toMatchObject({ ok: true });
  expect(c.hand()).toBe(before);
  expect(c.deadline()).toBe(deadline);
  expect(await c.play({ type: 'call' })).toMatchObject({ ok: true });
  await c.app.rooms.queue.idle();
  expect(c.hand().players[1]!.folded).toBe(true);
  expect(c.readRoom(c.roomId).participants[1]!.admission).toBe('leaving');
});
it('grants a waiting member exactly once after the terminal action, preserving result balances', async () => {
  const c = await context(),
    waiting = await c.guest('C');
  expect(
    await c.command(waiting.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'C',
    }),
  ).toMatchObject({ ok: true });
  expect(c.readRoom(c.roomId).participants[2]!.stack).toBe(0);
  expect(await c.play({ type: 'fold' })).toMatchObject({ ok: true });
  await c.app.rooms.queue.idle();
  expect(c.readRoom(c.roomId).participants[2]).toMatchObject({
    stack: 2000,
    admission: 'active',
    ready: false,
  });
  expect(
    c.storage.db.repositories
      .listLedger(c.roomId)
      .filter((e) => e.participantId === c.readRoom(c.roomId).participants[2]!.participantId),
  ).toHaveLength(1);
  expect(c.hand().players.reduce((n, p) => n + p.stack, 0)).toBe(4000);
});
it('retains a settled result but pauses when a boundary ledger insert fails atomically', async () => {
  const c = await context(),
    waiting = await c.guest('C');
  await c.command(waiting.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(c.roomId).row.roomCode,
    nickname: 'C',
  });
  c.storage.raw.exec(
    "CREATE TRIGGER reject_boundary BEFORE INSERT ON chip_ledger WHEN NEW.type='seat_grant' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  expect(await c.play({ type: 'fold' })).toMatchObject({ ok: true });
  await c.app.rooms.queue.idle();
  expect(c.hand().phase).toBe('settled');
  expect(c.app.database.hands.readHand(c.hand().handId)!.status).toBe('settled');
  expect(c.readRoom(c.roomId).row.status).toBe('pausedFault');
  expect(c.readRoom(c.roomId).participants[2]!.stack).toBe(0);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:boundary'")
      .get()?.n,
  ).toBe(0);
});
it('preserves an offline host until exact expiry then cashes out and transfers to the valid online human', async () => {
  const c = await context();
  await c.play({ type: 'fold' });
  const host = c.humans[0]!,
    pid = c.readRoom(c.roomId).row.hostParticipantId;
  host.socket.disconnect();
  await waitUntil(() => !c.app.sessions.registry.getCurrent(host.sessionId));
  await c.clock.advanceTo(119999);
  expect(c.readRoom(c.roomId).row.hostParticipantId).toBe(pid);
  await c.clock.advanceTo(120000);
  expect(c.readRoom(c.roomId).participants[0]).toMatchObject({ stack: 0, leftAt: 120000 });
  expect(c.readRoom(c.roomId).row.hostParticipantId).toBe(
    c.readRoom(c.roomId).participants[1]!.participantId,
  );
});

it('does not transfer an offline reserved host when its current hand settles before 120 seconds', async () => {
  const c = await context(),
    id = c.readRoom(c.roomId).row.hostParticipantId;
  c.humans[0]!.socket.disconnect();
  await waitUntil(() => !c.app.sessions.registry.getCurrent(c.humans[0]!.sessionId));
  await c.clock.advanceTo(30000);
  expect(c.hand().phase).toBe('settled');
  expect(c.readRoom(c.roomId).row.hostParticipantId).toBe(id);
});
it('publishes the committed boundary snapshot after timeout settlement', async () => {
  const c = await context(),
    w = await c.guest('Waiting');
  await c.command(w.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(c.roomId).row.roomCode,
    nickname: 'Waiting',
  });
  const seen: import('@orbit/protocol').RoomView[] = [];
  w.socket.on('room:view', (v) => seen.push(v));
  await c.clock.advanceTo(30000);
  await waitUntil(() => seen.length > 0);
  expect(seen.at(-1)!.seats[2]!.occupant!.stack).toBe(2000);
});
it('retries a failed boundary from the last persisted version and grants once', async () => {
  const c = await context(),
    w = await c.guest('Waiting');
  await c.command(w.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(c.roomId).row.roomCode,
    nickname: 'Waiting',
  });
  c.storage.raw.exec(
    "CREATE TRIGGER fail_boundary BEFORE INSERT ON chip_ledger WHEN NEW.type='seat_grant' BEGIN SELECT RAISE(ABORT,'fixture fail'); END",
  );
  await c.play({ type: 'fold' });
  expect(c.readRoom(c.roomId).boundaryPending).toBe(true);
  c.storage.raw.exec('DROP TRIGGER fail_boundary');
  expect(await c.app.rooms.executeBoundary(c.roomId)).toBe('applied');
  expect(await c.app.rooms.executeBoundary(c.roomId)).toBe('duplicate');
  expect(c.readRoom(c.roomId).participants[2]!.stack).toBe(2000);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:boundary'")
      .get()?.n,
  ).toBe(1);
});
it('treats a duplicate expiry during an active hand as idempotent', async () => {
  const c = await context({ players: 3 }),
    h = c.humans[1]!;
  h.socket.disconnect();
  await waitUntil(() => !c.app.sessions.registry.getCurrent(h.sessionId));
  const token = c.app.reservations.all()[0]!;
  await c.clock.advanceTo(120000, false);
  expect(await c.app.rooms.executeReservationExpiry(token, () => true)).toBe('applied');
  expect(await c.app.rooms.executeReservationExpiry(token, () => true)).toBe('duplicate');
  expect(c.readRoom(c.roomId).row.status).toBe('playing');
});
it('removes an ungranted waiting member immediately without changing the hand or ledger', async () => {
  const c = await context(),
    w = await c.guest('Waiting');
  await c.command(w.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(c.roomId).row.roomCode,
    nickname: 'Waiting',
  });
  const hand = c.hand();
  expect(
    await c.command(w.socket, 'room:leave', { commandId: randomUUID(), roomId: c.roomId }),
  ).toMatchObject({ ok: true });
  expect(c.hand()).toBe(hand);
  expect(c.readRoom(c.roomId).participants[2]).toMatchObject({ stack: 0, leftAt: 0 });
  expect(
    c.storage.db.repositories
      .listLedger(c.roomId)
      .filter((e) => e.participantId === c.readRoom(c.roomId).participants[2]!.participantId),
  ).toEqual([]);
});

it('LIFE02 local betting component folds the queued leaver when free check reaches it', () => {
  const f = partialLeaveScenario('LIFE02');
  const checked = applyBettingAction(f.round, 0, { type: 'check' });
  expect(checked.ok).toBe(true);
  if (!checked.ok) throw Error(checked.reason);
  expect(checked.state.actorSeatId).toBe(f.leaveSeatId);
  const folded = applyBettingAction(checked.state, f.leaveSeatId, { type: 'fold' });
  expect(folded.ok).toBe(true);
  if (!folded.ok) throw Error(folded.reason);
  expect(folded.state.actorSeatId).toBe(integer(record(f.expected.afterAdvance).actorSeatId));
  expect(folded.state.players.filter((p) => p.folded).map((p) => p.seatId)).toEqual(
    seats(record(f.expected.afterAdvance).foldedSeatIds),
  );
  expect(folded.effect.paidAmount).toBe(0);
});
it('LIFE03 local betting component folds immediately without withdrawing remaining chips', () => {
  const f = partialLeaveScenario('LIFE03'),
    folded = applyBettingAction(f.round, f.leaveSeatId, { type: 'fold' });
  expect(folded.ok).toBe(true);
  if (!folded.ok) throw Error(folded.reason);
  expect(folded.state.players.filter((p) => p.folded).map((p) => p.seatId)).toEqual(
    seats(f.expected.foldedSeatIds),
  );
  expect(folded.state.players.find((p) => p.seatId === f.leaveSeatId)!.stack).toBe(
    integer(f.expected.stackOfLeavingSeat),
  );
  expect(folded.effect.paidAmount).toBe(0);
});
it('LIFE04 real all-in exit keeps main-pot eligibility and cashes out its 300 award only after settlement', async () => {
  const f = allInLeaveScenario(),
    c = await context({ players: 3, dealerSeatId: 2, stacks: f.stacks, deck: f.deck });
  expect(c.actor().sessionId).toBe(c.humans[2]!.sessionId);
  expect(await c.play({ type: 'allIn' })).toMatchObject({ ok: true });
  expect(await c.play({ type: 'allIn' })).toMatchObject({ ok: true });
  expect(c.hand().players[0]!.allIn).toBe(true);
  const id = c.hand().players[0]!.participantId;
  expect(
    await c.command(c.humans[0]!.socket, 'room:leave', {
      commandId: randomUUID(),
      roomId: c.roomId,
    }),
  ).toMatchObject({ ok: true });
  expect(c.hand().players[0]!.folded).toBe(false);
  expect(c.readRoom(c.roomId).participants[0]!.leftAt).toBeNull();
  expect(await c.play({ type: 'allIn' })).toMatchObject({ ok: true });
  expect(c.hand().board).toEqual(f.given.settlementBoard);
  expect(c.hand().players.map((p) => p.stack)).toEqual([
    integer(record(f.expected.payouts).A),
    integer(record(f.expected.payouts).B),
    integer(record(f.expected.refunds).C),
  ]);
  expect(c.readRoom(c.roomId).participants.map((p) => p.stack)).toEqual([0, 300, 150]);
  expect(
    c.storage.db.repositories
      .listLedger(c.roomId)
      .filter((e) => e.type === 'seat_cashout' && e.participantId === id)
      .map((e) => e.delta),
  ).toEqual([-300]);
  expect(c.app.database.hands.readHand(c.hand().handId)!.result!.finalStacks[0]!.stack).toBe(300);
});

it('LIFE01 retains the frozen hand and grants the exact waiting admission once at its boundary', async () => {
  const f = lifecycleScenario('LIFE01'),
    afterJoin = record(f.expected.afterJoin),
    after = record(f.expected.afterBoundary),
    c = await context(),
    w = await c.guest('C'),
    ids = c.hand().players.map((p) => p.participantId);
  await c.command(w.socket, 'room:join', {
    commandId: randomUUID(),
    roomCode: c.readRoom(c.roomId).row.roomCode,
    nickname: 'C',
  });
  const member = c.readRoom(c.roomId).participants[2]!;
  expect(c.readRoom(c.roomId).participants.filter((p) => p.leftAt === null)).toHaveLength(
    integer(afterJoin.occupiedCount),
  );
  expect(c.hand().players.map((p) => p.participantId)).toEqual(ids);
  expect(member).toMatchObject({
    admission: afterJoin.joinerAdmission,
    stack: integer(afterJoin.joinerStack),
  });
  expect(
    projectPlayerView(
      c.readRoom(c.roomId),
      c.app.sessions,
      c.app.sessions.registry.getBySocket(w.socket.id!)!,
    )!.self.holeCards,
  ).toBeNull();
  await c.play({ type: 'fold' });
  expect(c.readRoom(c.roomId).participants[2]).toMatchObject({
    admission: after.joinerAdmission,
    stack: integer(after.joinerStack),
  });
  expect(c.readRoom(c.roomId).participants.every((p) => !p.ready)).toBe(true);
  expect(await c.app.rooms.executeBoundary(c.roomId)).toBe('duplicate');
});
it('LIFE09 closes only at B last reservation at 130000 after original 45000 settlement', async () => {
  const f = lifecycleScenario('LIFE09'),
    c = await lifecycleContext({ players: 2, bots: integer(f.given.botCount) });
  try {
    await c.start();
    const times = record(f.given.humanDisconnectTimes);
    await c.clock.advanceTo(integer(times.A), false);
    c.humans[0]!.socket.disconnect();
    await waitUntil(() => !c.app.sessions.registry.getCurrent(c.humans[0]!.sessionId));
    await c.clock.advanceTo(integer(times.B), false);
    c.humans[1]!.socket.disconnect();
    await waitUntil(() => !c.app.sessions.registry.getCurrent(c.humans[1]!.sessionId));
    await c.app.rooms.queue.idle();
    await c.clock.advanceTo(integer(f.given.handFinishesAt), false);
    while (c.room().hand!.phase !== 'settled') await trustedLifecycleAction(c, { type: 'fold' });
    const handId = c.room().hand!.handId;
    for (const [i, at] of (f.given.observedAt as number[]).entries()) {
      await c.clock.advanceTo(at);
      expect(c.room().row.status === 'closed').toBe(
        (f.expected.closedAtObservations as boolean[])[i],
      );
    }
    expect(c.room().row.closedAt).toBe(integer(f.expected.roomClosedAt));
    expect(c.room().hand!.handId).toBe(handId);
    expect(c.app.database.hands.readHand(handId)!.status).toBe('settled');
    expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hands').get()?.n).toBe(1);
  } finally {
    await c.close();
  }
});
it('cancels an old reservation generation after restoration and checks the new deadline instead', async () => {
  const c = await context();
  await c.play({ type: 'fold' });
  const h = c.humans[0]!;
  h.socket.disconnect();
  await waitUntil(() => !c.app.sessions.registry.getCurrent(h.sessionId));
  const old = c.app.reservations.all()[0]!;
  await c.clock.advanceTo(5000);
  const next = await c.guest('Next');
  expect(
    await request(
      next.socket,
      'session:resume',
      resumeRequest(h.resumeToken, { roomId: c.roomId }),
    ),
  ).toMatchObject({ ok: true, outcome: 'seatRestored' });
  next.socket.disconnect();
  await waitUntil(() => !c.app.sessions.registry.getCurrent(h.sessionId));
  await c.clock.advanceTo(120000);
  expect(c.readRoom(c.roomId).participants[0]!.leftAt).toBeNull();
  expect(
    await c.app.rooms.executeReservationExpiry(
      old,
      () => c.app.reservations.get(old.roomId, old.participantId) === old,
    ),
  ).toBe('stale');
  await c.clock.advanceTo(125000);
  expect(c.readRoom(c.roomId).participants[0]!.leftAt).toBe(125000);
});
it('LIFE07 cashes out exactly the real remaining 1800 at expiry then requires a new join', async () => {
  const c = await context();
  expect(await c.play({ type: 'raise', raiseTo: 200 })).toMatchObject({ ok: true });
  await c.play({ type: 'call' });
  await c.play({ type: 'check' });
  await c.play({ type: 'fold' });
  expect(c.readRoom(c.roomId).participants[0]!.stack).toBe(1800);
  const h = c.humans[0]!,
    old = c.readRoom(c.roomId).participants[0]!.participantId;
  h.socket.disconnect();
  await waitUntil(() => !c.app.sessions.registry.getCurrent(h.sessionId));
  await c.clock.advanceTo(120000);
  expect(
    c.storage.db.repositories
      .listLedger(c.roomId)
      .filter((e) => e.type === 'seat_cashout' && e.participantId === old)
      .map((e) => e.delta),
  ).toEqual([-1800]);
  const next = await c.guest('Next');
  expect(
    await request(
      next.socket,
      'session:resume',
      resumeRequest(h.resumeToken, { roomId: c.roomId }),
    ),
  ).toMatchObject({ ok: true, outcome: 'identityOnly' });
  expect(
    await c.command(next.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'A',
    }),
  ).toMatchObject({ ok: true });
  expect(
    c.readRoom(c.roomId).participants.find((p) => p.sessionId === h.sessionId && p.leftAt === null)!
      .participantId,
  ).not.toBe(old);
});
