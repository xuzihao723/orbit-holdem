import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { privacyContext } from '../helpers/privacy-context.js';
import { gameContext } from '../helpers/game-context.js';
import { waitingSequences } from '../helpers/privacy-scenarios.js';
import { request, resumeRequest } from '../helpers/session-context.js';
import { projectPlayerView } from '../../apps/server/src/game/player-view.js';
import { projectPublicHand } from '../../apps/server/src/game/public-hand-view.js';
import { publicSequencesAfter } from '../../apps/server/src/game/public-sequences.js';
import type { PlayerView } from '@orbit/protocol';
import { getHandLegalActions } from '../../packages/poker-core/src/index.js';
const contexts: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
const tick = () => new Promise((r) => setTimeout(r, 25));
function noCards(value: unknown, hidden: readonly string[]) {
  const text = JSON.stringify(value);
  for (const card of hidden) expect(text).not.toContain('"' + card + '"');
  for (const key of ['deck', 'burnCards', 'resumeToken', 'tokenHash', 'botPrivateState'])
    expect(text).not.toContain('"' + key + '"');
}
it('projects original PRIV01 from a reachable flop with folded owner privacy', async () => {
  const c = await privacyContext();
  contexts.push(c);
  const state = c.readRoom(c.roomId),
    pub = projectPublicHand(state)!;
  expect(pub.board).toEqual(c.fixture.board);
  expect(pub.phase).toBe('flop');
  expect(state.hand!.players[1]!.folded).toBe(true);
  noCards(pub, c.fixture.omitted);
  for (const [i, h] of c.humans.entries()) {
    const v = projectPlayerView(
      state,
      c.app.sessions,
      c.app.sessions.registry.getCurrent(h.sessionId)!,
    )!;
    expect(v.self.holeCards).toEqual(c.fixture.owners[i]);
    noCards(
      v,
      c.fixture.omitted.filter((card) => !c.fixture.owners[i]!.includes(card)),
    );
    expect(v.self.legalActions.allowed.length > 0).toBe(i === 2);
  }
});
it('publishes only current private snapshots to a new waiting guest, without earlier events', async () => {
  const c = await privacyContext();
  contexts.push(c);
  const d = await c.guest('D'),
    frames: { event: string; data: unknown }[] = [];
  d.socket.onAny((event, data) => frames.push({ event, data }));
  expect(
    await c.command(d.socket, 'room:join', {
      commandId: randomUUID(),
      roomCode: c.readRoom(c.roomId).row.roomCode,
      nickname: 'D',
    }),
  ).toMatchObject({ ok: true });
  await tick();
  const view = frames.find((f) => f.event === 'game:view')!.data as PlayerView;
  expect(view.board).toEqual(c.fixture.board);
  expect(view.self).toMatchObject({
    admission: 'waitingNextHand',
    holeCards: null,
    legalActions: { allowed: [] },
  });
  noCards(frames, c.fixture.omitted);
  expect(frames.every((f) => ['command:ack', 'room:view', 'game:view'].includes(f.event))).toBe(
    true,
  );
  const seq = waitingSequences();
  expect(
    publicSequencesAfter(
      [...seq.before, ...seq.after].map((sequence) => ({
        sequence,
        visibility: 'public' as const,
      })),
      seq.watermark,
    ),
  ).toEqual(seq.expected);
});
it('stops private delivery to a connected taken-over socket and filters rejection snapshots', async () => {
  const c = await privacyContext();
  contexts.push(c);
  await tick();
  const old = c.humans[0]!,
    frames: unknown[] = [];
  old.socket.on('game:view', (v) => frames.push(v));
  const replacement = await c.guest('Replacement');
  expect(
    (await request(replacement.socket, 'session:resume', resumeRequest(old.resumeToken))).ok,
  ).toBe(true);
  const fresh: PlayerView[] = [];
  replacement.socket.on('game:view', (v) => fresh.push(v));
  await c.play({ type: 'check' });
  await tick();
  expect(old.socket.connected).toBe(true);
  expect(frames).toHaveLength(0);
  expect(fresh.at(-1)!.self.holeCards).toEqual(c.fixture.owners[0]);
  noCards(fresh, ['KS', 'KH', 'QS', 'QH', '5D', '6D']);
});
it('keeps folded opponents hidden at actual showdown and zeroes the live pot', async () => {
  const c = await privacyContext();
  contexts.push(c);
  await c.passive();
  const pub = projectPublicHand(c.readRoom(c.roomId))!;
  expect(pub.potTotal).toBe(0);
  expect(pub.pots).toEqual([]);
  expect(pub.showdownCards).toHaveLength(2);
  noCards(pub, ['KS', 'KH', '5D', '6D']);
});
it('projects four active players independently and reveals no all-in cards before response', async () => {
  const c = await gameContext({ players: 4 });
  contexts.push(c);
  for (const h of c.humans) {
    const state = c.readRoom(c.roomId),
      v = projectPlayerView(
        state,
        c.app.sessions,
        c.app.sessions.registry.getCurrent(h.sessionId)!,
      )!;
    const own = state.hand!.players.find((p) => p.participantId === v.self.participantId)!;
    expect(v.self.holeCards).toEqual(own.holeCards);
    noCards(
      v,
      state.hand!.players.filter((p) => p !== own).flatMap((p) => p.holeCards),
    );
  }
  const actor = c.actor();
  await c.play({ type: 'allIn' });
  const state = c.readRoom(c.roomId),
    v = projectPlayerView(
      state,
      c.app.sessions,
      c.app.sessions.registry.getCurrent(actor.sessionId)!,
    )!;
  expect(v.self.legalActions.allowed).toEqual([]);
  expect(v.showdownCards).toEqual([]);
  expect(v.potTotal).toBe(state.hand!.players.reduce((n, p) => n + p.handCommitted, 0));
});
it('scans all actual member frames and rejection snapshots for other hidden cards', async () => {
  const c = await privacyContext();
  contexts.push(c);
  await tick();
  const frames = c.humans.map(() => [] as unknown[]);
  for (const [i, h] of c.humans.entries())
    h.socket.onAny((event, data) => frames[i]!.push({ event, data }));
  const actor = c.actor(),
    cmd = c.actionCommand({ type: 'check' });
  expect((await c.command(actor.socket, 'game:action', cmd)).ok).toBe(true);
  await tick();
  expect(
    await c.command(c.humans[1]!.socket, 'game:action', c.actionCommand({ type: 'check' })),
  ).toMatchObject({ ok: false });
  await tick();
  for (const [i, list] of frames.entries()) {
    expect(list.length).toBeGreaterThan(0);
    noCards(
      list,
      c.fixture.omitted.filter((card) => !c.fixture.owners[i]!.includes(card)),
    );
  }
});
it('sends no candidate private frame after persistence failure and no outsider frame', async () => {
  const c = await gameContext();
  contexts.push(c);
  await tick();
  const frames: PlayerView[] = [];
  for (const h of c.humans) h.socket.on('game:view', (v) => frames.push(v));
  const outsider = await c.guest('Outsider'),
    outside: unknown[] = [];
  outsider.socket.onAny((event, data) => outside.push({ event, data }));
  expect(
    await c.command(outsider.socket, 'game:action', c.actionCommand({ type: 'call' })),
  ).toMatchObject({ code: 'ROOM_FORBIDDEN', roomId: null });
  expect(outside.filter((v) => JSON.stringify(v).includes('holeCards'))).toEqual([]);
  c.storage.raw.exec('BEGIN IMMEDIATE');
  try {
    expect(await c.play({ type: 'call' })).toMatchObject({ code: 'PERSISTENCE_UNAVAILABLE' });
  } finally {
    c.storage.raw.exec('ROLLBACK');
  }
  await tick();
  expect(frames).toEqual([]);
});
it('keeps an uncontested result private and a short all-in faithful to core legal actions', async () => {
  const c = await gameContext({ stacks: [15, 2000] });
  contexts.push(c);
  const state = c.readRoom(c.roomId),
    actor = c.actor(),
    view = projectPlayerView(
      state,
      c.app.sessions,
      c.app.sessions.registry.getCurrent(actor.sessionId)!,
    )!;
  expect(view.self.legalActions).toEqual(getHandLegalActions(c.hand(), 0));
  expect(view.self.legalActions.allowed).not.toContain('call');
  expect(view.self.legalActions.allIn!.kind).toBe('call');
  await c.play({ type: 'fold' });
  const h = c.hand();
  expect(h.phase).toBe('settled');
  expect(h.result!.reason).toBe('allOthersFolded');
  const pub = projectPublicHand(c.readRoom(c.roomId))!;
  expect(pub.showdownCards).toEqual([]);
  noCards(
    pub,
    h.players.flatMap((p) => p.holeCards),
  );
});
