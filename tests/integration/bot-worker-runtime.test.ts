import { expect, it } from 'vitest';
import { standardContext } from '../helpers/standard-context.js';
import { waitUntil } from '../helpers/reconnect-context.js';
import { botActionCommand } from '../../apps/server/src/game/internal-command.js';
import { projectBotObservation } from '../../apps/server/src/bots/observation.js';
const late = new URL('../.generated-workers/late.worker.js', import.meta.url);
const release = (buffer: SharedArrayBuffer) => {
  Atomics.store(new Int32Array(buffer), 0, 1);
  Atomics.notify(new Int32Array(buffer), 0);
};
it('cancels a result when its bot is removed at a real hand boundary', async () => {
  const gate = new SharedArrayBuffer(4),
    c = await standardContext({ size: 1, budgetMs: 1000, workerUrl: late, workerData: gate });
  try {
    await waitUntil(() => c.app.workerPool.stats.runningJobs === 1);
    const o = projectBotObservation(c.room(), c.room().participants[1]!.botId!)!;
    expect(await c.app.rooms.executeBotAction(botActionCommand(o, { type: 'fold' }))).toBe(
      'applied',
    );
    expect(
      await c.command(c.humans[0]!.socket, 'room:bot:remove', { ...c.version(), seatId: 1 }),
    ).toMatchObject({ ok: true });
    const after = c.room().hand;
    release(gate);
    await c.clock.advanceTo(1000);
    expect(c.room().hand).toBe(after);
    expect(c.app.bots.diagnostics.active).toBe(0);
    expect(c.room().row.status).not.toBe('pausedFault');
  } finally {
    release(gate);
    await c.close();
  }
});
it('does not spend a worker result returned after the original action deadline', async () => {
  const gate = new SharedArrayBuffer(4),
    c = await standardContext({ size: 1, budgetMs: 1000, workerUrl: late, workerData: gate });
  try {
    await waitUntil(() => c.app.workerPool.stats.runningJobs === 1);
    const token = { ...c.room().turnClock!, roomId: c.roomId },
      before = c.room().hand!;
    await c.clock.advanceTo(token.deadline, false);
    release(gate);
    await waitUntil(() => c.app.workerPool.stats.pendingJobs === 0);
    await c.clock.advanceTo(token.deadline);
    expect(c.room().hand!.handVersion).toBe(before.handVersion + 1);
    expect(
      c.storage.raw
        .prepare('SELECT COUNT(*) n FROM command_receipts WHERE command_id=?')
        .get('bot:' + token.handId + ':' + token.turnId)?.n,
    ).toBe(0);
    expect(
      c.storage.raw
        .prepare('SELECT COUNT(*) n FROM command_receipts WHERE command_id=?')
        .get('timeout:' + token.handId + ':' + token.turnId)?.n,
    ).toBe(1);
  } finally {
    release(gate);
    await c.close();
  }
});
it('keeps a valid hand job across waiting-member roomVersion changes', async () => {
  const gate = new SharedArrayBuffer(4),
    c = await standardContext({ size: 1, budgetMs: 1000, workerUrl: late, workerData: gate });
  try {
    await waitUntil(() => c.app.workerPool.stats.runningJobs === 1);
    const before = c.room().hand!,
      version = c.room().row.roomVersion,
      w = await c.guest('Waiting');
    expect(
      await c.command(w.socket, 'room:join', {
        commandId: crypto.randomUUID(),
        roomCode: c.room().row.roomCode,
        nickname: 'Waiting',
      }),
    ).toMatchObject({ ok: true });
    expect(c.room().row.roomVersion).toBeGreaterThan(version);
    expect(c.room().hand).toBe(before);
    release(gate);
    await waitUntil(() => c.app.workerPool.stats.pendingJobs === 0);
    await c.clock.advanceTo(1000);
    expect(c.room().hand!.handVersion).toBe(before.handVersion + 1);
    expect(c.app.bots.diagnostics.workerAcceptedActions).toBe(1);
  } finally {
    release(gate);
    await c.close();
  }
});
it('cancels a worker when timeout changes the turn and discards its delayed result', async () => {
  const gate = new SharedArrayBuffer(4),
    c = await standardContext({ size: 1, budgetMs: 1000, workerUrl: late, workerData: gate });
  try {
    await waitUntil(() => c.app.workerPool.stats.runningJobs === 1);
    const token = { ...c.room().turnClock!, roomId: c.roomId };
    await c.clock.advanceTo(token.deadline, false);
    expect(await c.app.rooms.executeTimeout(token)).toBe('applied');
    const after = c.room().hand;
    release(gate);
    await waitUntil(() => c.app.workerPool.stats.pendingJobs === 0);
    await c.clock.advanceTo(token.deadline);
    expect(c.room().hand).toBe(after);
    expect(c.app.bots.diagnostics.discardedStale).toBeGreaterThan(0);
    expect(c.app.workerPool.records[0]!.outcome).toMatchObject({
      kind: 'fallback',
      reason: 'cancelled',
    });
  } finally {
    release(gate);
    await c.close();
  }
});
it('does not apply a previous hand estimate after a genuine settlement and new hand', async () => {
  const gate = new SharedArrayBuffer(4),
    c = await standardContext({ size: 1, budgetMs: 1000, workerUrl: late, workerData: gate });
  try {
    await waitUntil(() => c.app.workerPool.stats.runningJobs === 1);
    const o = projectBotObservation(c.room(), c.room().participants[1]!.botId!)!;
    expect(await c.app.rooms.executeBotAction(botActionCommand(o, { type: 'fold' }))).toBe(
      'applied',
    );
    await c.start();
    const next = c.room().hand!;
    expect(next.handId).not.toBe(o.handId);
    expect(next.handVersion).toBe(1);
    release(gate);
    await c.clock.advanceTo(999);
    expect(c.room().hand).toBe(next);
    expect(c.room().row.status).toBe('playing');
  } finally {
    release(gate);
    await c.close();
  }
});
it('cancels a paused or removed bot and closes all real workers before database teardown', async () => {
  const gate = new SharedArrayBuffer(4),
    c = await standardContext({ size: 1, budgetMs: 1000, workerUrl: late, workerData: gate });
  try {
    await waitUntil(() => c.app.workerPool.stats.runningJobs === 1);
    const before = c.room().hand!,
      pool = c.app.workerPool;
    c.app.rooms.pauseForFault(c.roomId);
    release(gate);
    await c.clock.advanceTo(1000);
    expect(c.room().hand).toBe(before);
    expect(c.app.bots.diagnostics.active).toBe(0);
    await c.app.close();
    expect(pool.stats.activeWorkers).toBe(0);
    expect(pool.stats.pendingJobs).toBe(0);
    expect(c.storage.db.hands.readHand(before.handId)!.handVersion).toBe(before.handVersion);
  } finally {
    release(gate);
    await c.close();
  }
});
it('uses a basic fallback after a real worker crash while preserving chips', async () => {
  const c = await standardContext({
    size: 1,
    budgetMs: 500,
    workerUrl: new URL('../.generated-workers/crash.worker.js', import.meta.url),
  });
  try {
    await waitUntil(() => c.app.workerPool.records.length > 0);
    const before = c.room().hand!;
    await c.clock.advanceTo(1000);
    expect(c.room().hand!.handVersion).toBe(before.handVersion + 1);
    expect(c.room().hand!.players.reduce((n, p) => n + p.stack + p.handCommitted, 0)).toBe(4000);
    expect(c.app.bots.diagnostics.workerFallbacks).toBe(1);
    expect(c.app.bots.diagnostics.workerAcceptedActions).toBe(0);
  } finally {
    await c.close();
  }
});
it('starts standard postflop computation before display and later applies an actual worker estimate', async () => {
  const c = await standardContext({ size: 1, budgetMs: 1000 });
  try {
    expect(c.room().hand!.phase).toBe('flop');
    expect((c.app.bots.diagnostics as { workerJobs?: number }).workerJobs ?? 0).toBeGreaterThan(0);
    await waitUntil(() => c.app.workerPool.records.length > 0);
    const before = c.room().hand!;
    expect(c.clock.now()).toBe(500);
    await c.clock.advanceTo(1000);
    expect(c.room().hand!.handVersion).toBe(before.handVersion + 1);
    expect(c.app.bots.diagnostics.workerDecisions).toBe(1);
    expect(c.app.bots.diagnostics.standardEngineUnavailable).toBe(0);
    expect(c.app.workerPool.records[0]!.outcome.kind).toBe('estimate');
  } finally {
    await c.close();
  }
});
