import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { GuestIssued, PlayerView, RoomView } from '@orbit/protocol';
import { gameContext } from '../helpers/game-context.js';
import { projectPlayerView } from '../../apps/server/src/game/player-view.js';
import { projectRoomView } from '../../apps/server/src/rooms/room-view.js';
import { ViewStore } from '../../apps/web/src/network/view-store.js';
it('notifies subscribers only on state changes and unsubscribes cleanly', () => {
  const s = store();
  expect(s.subscribe).toBeTypeOf('function');
  let called = 0;
  const off = s.subscribe(() => called++),
    before = s.snapshot;
  s.receiveRoom(room);
  expect(s.snapshot).toBe(before);
  expect(called).toBe(0);
  s.disconnect();
  expect(called).toBe(1);
  off();
  s.close();
  expect(called).toBe(1);
});
it('keeps the authenticated participant separate from public room data and clears it on identity-only recovery', () => {
  const s = store(),
    { resumeToken, ...base } = identity;
  void resumeToken;
  const requestId = randomUUID();
  s.beginIdentity(1, requestId);
  expect(
    s.establishIdentity(
      {
        ...base,
        requestId,
        outcome: 'seatRestored',
        participantId: player.self.participantId,
        roomView: room,
        playerView: player,
      },
      1,
      requestId,
      'resume',
    ),
  ).toBe(true);
  expect(s.snapshot.authContext).toMatchObject({
    sessionId: identity.sessionId,
    participantId: player.self.participantId,
    roomId: room.roomId,
  });
  const next = randomUUID();
  s.beginIdentity(1, next);
  expect(
    s.establishIdentity(
      {
        ...base,
        requestId: next,
        outcome: 'identityOnly',
        reason: 'seatExpired',
        roomView: null,
        playerView: null,
      },
      1,
      next,
      'resume',
    ),
  ).toBe(true);
  expect(s.snapshot.authContext?.participantId).toBeNull();
  expect(s.snapshot.roomView).toBeNull();
  expect(s.snapshot.playerView).toBeNull();
});
it('clears the old hand and exposes its interruption without pretending a seat was restored', () => {
  const s = store(),
    { resumeToken, ...base } = identity;
  void resumeToken;
  const requestId = randomUUID();
  s.beginIdentity(1, requestId);
  s.establishIdentity(
    {
      ...base,
      requestId,
      outcome: 'handInterrupted',
      interruptedHandId: player.handId,
      roomView: null,
      playerView: null,
    },
    1,
    requestId,
    'resume',
  );
  expect(s.snapshot.interruptedHandId).toBe(player.handId);
  expect(s.snapshot.playerView).toBeNull();
  expect(s.snapshot.selectedRoomId).toBeNull();
});
let c: Awaited<ReturnType<typeof gameContext>>,
  player: PlayerView,
  room: RoomView,
  identity: GuestIssued;
it('accepts a contract-valid long combining nickname without dropping the whole room', () => {
  const s = store();
  const v = structuredClone({ ...room, roomVersion: room.roomVersion + 1 });
  v.seats[0]!.occupant!.nickname = 'A' + '\u0301'.repeat(600);
  expect(s.receiveRoom(v)).toBe(true);
});
beforeAll(async () => {
  c = await gameContext();
  const { socket, ...issued } = c.humans[0]!;
  void socket;
  identity = issued;
  const state = c.readRoom(c.roomId);
  player = projectPlayerView(
    state,
    c.app.sessions,
    c.app.sessions.registry.getCurrent(identity.sessionId)!,
  )!;
  room = projectRoomView(state, c.app.sessions, c.app.sessions.meta());
});
afterAll(async () => c?.close());
function store() {
  const s = new ViewStore(),
    connection = s.beginConnection();
  s.beginIdentity(connection, identity.requestId);
  expect(s.establishIdentity(identity, connection, identity.requestId, 'guest')).toBe(true);
  s.selectRoom(room.roomId);
  s.receiveRoom(room);
  s.receivePlayer(player);
  return s;
}
it('anchors different hands by RoomView rather than comparing their numeric versions', () => {
  const s = store();
  s.receivePlayer({ ...player, handId: 'h2', handVersion: 1 });
  expect(s.snapshot.playerView!.handId).toBe(player.handId);
  s.receiveRoom({ ...room, roomVersion: room.roomVersion + 1, currentHandId: 'h2' });
  expect(s.snapshot.playerView!.handId).toBe('h2');
  s.receivePlayer({ ...player, handVersion: 999 });
  expect(s.snapshot.playerView!.handId).toBe('h2');
});
it('accepts newer hand data with an older embedded room version without rolling back RoomView', () => {
  const s = store();
  s.receiveRoom({ ...room, roomVersion: room.roomVersion + 5 });
  s.receivePlayer({
    ...player,
    handVersion: player.handVersion + 1,
    roomVersion: room.roomVersion - 1,
  });
  expect(s.snapshot.playerView!.handVersion).toBe(player.handVersion + 1);
  expect(s.snapshot.roomView!.roomVersion).toBe(room.roomVersion + 5);
});
it('does not let older hand data replace a newer hand despite larger roomVersion', () => {
  const s = store();
  s.receivePlayer({ ...player, handVersion: 5 });
  s.receivePlayer({ ...player, handVersion: 2, roomVersion: 100 });
  expect(s.snapshot.playerView!.handVersion).toBe(5);
});
it('updates equal-hand permissions without replacing hand fields or owner cards', () => {
  const s = store();
  s.receivePlayer({
    ...player,
    roomVersion: room.roomVersion + 1,
    board: ['AS'],
    self: {
      ...player.self,
      holeCards: ['2S', '3S'],
      admission: 'leaving',
      legalActions: { allowed: [], callAmount: 0, minRaiseTo: null, maxRaiseTo: null, allIn: null },
    },
  });
  expect(s.snapshot.playerView!.board).toEqual(player.board);
  expect(s.snapshot.playerView!.self.holeCards).toEqual(player.self.holeCards);
  expect(s.snapshot.playerView!.self.admission).toBe('leaving');
});
it('uses acknowledgements only for pending status, preserving the current chips', () => {
  const s = store(),
    before = s.snapshot.playerView,
    commandId = randomUUID();
  s.trackCommand('game:action', {
    commandId,
    roomId: room.roomId,
    handId: player.handId,
    turnId: player.turnId!,
    expectedVersion: player.handVersion,
    action: { type: 'call' },
  });
  s.receiveAck({
    ...c.app.sessions.meta(),
    commandId,
    ok: true,
    duplicate: true,
    roomId: room.roomId,
    appliedRoomVersion: 1,
    handId: player.handId,
    appliedHandVersion: 1,
  });
  expect(s.snapshot.playerView).toBe(before);
  expect(s.snapshot.pending[commandId]!.status).toBe('confirmed');
});
it('quarantines unknown epochs and accepts changes only through the current private identity response', () => {
  const s = store();
  s.receivePlayer({ ...player, serverEpoch: 'new' });
  s.receiveRoom({ ...room, serverEpoch: 'new' });
  expect(s.snapshot.activeEpoch).toBe(identity.serverEpoch);
  expect(s.snapshot.syncNeeded).toBe(true);
  expect(s.snapshot.controlReady).toBe(false);
  const connection = s.beginConnection(),
    requestId = randomUUID();
  s.beginIdentity(connection, requestId);
  expect(
    s.establishIdentity(
      { ...identity, requestId, serverEpoch: 'new' },
      connection,
      requestId,
      'guest',
    ),
  ).toBe(true);
  expect(s.snapshot.playerView).toBeNull();
  expect(s.snapshot.activeEpoch).toBe('new');
  expect(s.establishIdentity(identity, connection - 1, identity.requestId, 'guest')).toBe(false);
  expect(s.snapshot.activeEpoch).toBe('new');
});
it('bounds future-hand buffering and ignores other rooms and nonselected results', () => {
  const s = store();
  for (let i = 0; i < 10; i++) s.receivePlayer({ ...player, handId: 'future' + i });
  expect(s.bufferedHandCount).toBeLessThanOrEqual(4);
  s.receiveRoom({ ...room, roomId: 'foreign', roomVersion: 100 });
  expect(s.snapshot.roomView!.roomId).toBe(room.roomId);
});
it('rejects malformed nested wire fields, unknown fields, invalid card pairs and unsafe integers', () => {
  for (const bad of [
    { ...player, deck: [] },
    { ...player, self: { ...player.self, holeCards: ['AS'] } },
    { ...player, players: player.players.map((p) => ({ ...p, holeCards: ['AS', 'AH'] })) },
    { ...player, handVersion: Infinity },
    {
      ...player,
      self: { ...player.self, legalActions: { ...player.self.legalActions, allowed: ['hack'] } },
    },
  ]) {
    const s = store();
    expect(s.receivePlayer(bad)).toBe(false);
    expect(s.snapshot.playerView!.handVersion).toBe(player.handVersion);
  }
});
it('freezes accepted input independently of subsequent caller mutation', () => {
  const s = store(),
    input = structuredClone({ ...player, handVersion: 2 });
  s.receivePlayer(input);
  input.players[0]!.stack = 0;
  expect(s.snapshot.playerView!.players[0]!.stack).toBe(player.players[0]!.stack);
  expect(Object.isFrozen(s.snapshot.playerView!.players)).toBe(true);
});
it('revokes actions while authenticating and clears prior owner data on a new identity in the same epoch', () => {
  const s = store(),
    requestId = randomUUID();
  s.beginIdentity(1, requestId);
  expect(s.snapshot.controlReady).toBe(false);
  expect(s.snapshot.playerView).toBeNull();
  expect(
    s.establishIdentity({ ...identity, sessionId: 'new-owner', requestId }, 1, requestId, 'guest'),
  ).toBe(true);
  expect(s.snapshot.roomView).toBeNull();
  expect(s.snapshot.selectedRoomId).toBeNull();
});
it('rejects unsolicited identity responses and invalidates late responses after disconnect', () => {
  const s = store();
  expect(
    s.establishIdentity({ ...identity, serverEpoch: 'foreign' }, 1, randomUUID(), 'guest'),
  ).toBe(false);
  const requestId = randomUUID();
  s.beginIdentity(1, requestId);
  s.disconnect();
  expect(
    s.establishIdentity({ ...identity, requestId, serverEpoch: 'foreign' }, 1, requestId, 'guest'),
  ).toBe(false);
  expect(s.snapshot.activeEpoch).toBe(identity.serverEpoch);
});
it('cannot repopulate private data from delayed frames while disconnected, authenticating or epoch-suspended', () => {
  for (const stop of [
    (s: ViewStore) => s.disconnect(),
    (s: ViewStore) => s.beginIdentity(1, randomUUID()),
    (s: ViewStore) => s.receivePlayer({ ...player, serverEpoch: 'foreign' }),
  ]) {
    const s = store();
    s.receivePlayer({ ...player, handId: 'future' });
    stop(s);
    expect(s.receivePlayer({ ...player, handVersion: 99 })).toBe(false);
    expect(s.snapshot.playerView).toBeNull();
    expect(s.bufferedHandCount).toBe(0);
  }
});
it('ignores prior-owner failure acknowledgements after a new private identity is established', () => {
  const s = store(),
    commandId = randomUUID(),
    requestId = randomUUID();
  s.trackCommand('room:create', { commandId, capacity: 2, nickname: 'A' });
  s.beginIdentity(1, requestId);
  s.establishIdentity({ ...identity, requestId, sessionId: 'new-owner' }, 1, requestId, 'guest');
  s.receiveAck({
    ...c.app.sessions.meta(),
    commandId,
    duplicate: false,
    ok: false,
    code: 'SESSION_TAKEN_OVER',
    retryable: false,
    retryAfterMs: null,
    fieldIssues: [],
    roomId: null,
    handId: null,
    latestRoomVersion: null,
    latestHandVersion: null,
  });
  expect(s.snapshot.status).toBe('ready');
  expect(s.snapshot.controlReady).toBe(true);
});
