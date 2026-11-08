import { expect, test } from 'vitest';
import { gameContext } from '../helpers/game-context.js';
import { allInLeaveScenario } from '../helpers/lifecycle-scenarios.js';
import { projectReplay } from '../../apps/server/src/persistence/replay-projector.js';
import type { PlayerView } from '@orbit/protocol';
for (const count of [2, 3, 4] as const)
  test('exact public replay for ' + count + ' human showdown', async () => {
    const c = await gameContext({ players: count });
    const committed = new Map<number, PlayerView>();
    const unlisten = c.app.onPublish((publication) => {
      if (publication.event === 'game:view' && publication.socketId === c.humans[0]!.socket.id)
        committed.set(publication.payload.handVersion, publication.payload);
    });
    try {
      await c.passive();
      const row = c.app.database.hands.readHand(c.hand().handId)!,
        events = c.app.database.repositories.readReplayEvents(row.handId);
      const replay = await projectReplay(row, events, row.participantIds[0]!);
      expect(replay.frames.at(-1)!.state.players.map((p) => p.stack)).toEqual(
        row.result!.finalStacks.map((p) => p.stack),
      );
      expect(replay.frames.at(-1)!.state.board).toEqual(row.result!.board);
      expect(committed.size).toBeGreaterThan(0);
      for (const [version, view] of committed) {
        const frame = replay.frames.filter((f) => f.state.handVersion === version).at(-1);
        expect(frame?.state).toMatchObject({
          phase: view.phase,
          board: view.board,
          players: view.players,
          actorSeatId: view.actorSeatId,
          potTotal: view.potTotal,
        });
      }
      for (const frame of replay.frames)
        expect(frame.state.players.reduce((n, p) => n + p.stack + p.handCommitted, 0)).toBe(
          count * 2000,
        );
      expect(replay.frames.filter((f) => f.state.phase === 'settled')).toHaveLength(1);
      expect(replay.stageStarts.map((s) => s.phase)).toEqual([
        'preflop',
        'flop',
        'turn',
        'river',
        'showdown',
        'settled',
      ]);
      const broken = events.map((e) =>
        e.kind === 'paidOut' ? { ...e, payload: { ...(e.payload as object), amount: 1 } } : e,
      );
      await expect(projectReplay(row, broken, row.participantIds[0]!)).rejects.toThrow();
    } finally {
      unlisten();
      await c.close();
    }
  });
test('LIFE04 exact refunds and side-pot awards conserve every emitted frame', async () => {
  const f = allInLeaveScenario(),
    c = await gameContext({ players: 3, dealerSeatId: 2, stacks: f.stacks, deck: f.deck });
  try {
    for (let i = 0; i < 3; i++) await c.play({ type: 'allIn' });
    const row = c.app.database.hands.readHand(c.hand().handId)!,
      replay = await projectReplay(
        row,
        c.app.database.repositories.readReplayEvents(row.handId),
        row.participantIds[2]!,
      );
    expect(replay.frames.at(-1)!.state.players.map((p) => p.stack)).toEqual([300, 300, 150]);
    for (const frame of replay.frames)
      expect(frame.state.players.reduce((n, p) => n + p.stack + p.handCommitted, 0)).toBe(750);
    expect(replay.frames.some((f) => f.actionText.includes('返还未匹配下注 150'))).toBe(true);
    expect(replay.result!.refunds).toEqual([{ participantId: row.participantIds[2], amount: 150 }]);
  } finally {
    await c.close();
  }
});
