import { afterEach, expect, it } from 'vitest';
import { botContext } from '../helpers/bot-context.js';
import { BotScheduler } from '../../apps/server/src/bots/scheduler.js';
import { lifecycleContext } from '../helpers/lifecycle-context.js';
it('keeps one delayed or queued job for the same turn and does not hold another room hostage', async () => {
  const c = await botContext({ delayRandom: { next: () => 0.999 } });
  contexts.push(c);
  const before = c.room().hand!,
    scheduled = c.app.bots.diagnostics.scheduled;
  c.app.bots.sync(c.room());
  c.app.bots.sync(c.room());
  expect(c.app.bots.diagnostics.scheduled).toBe(scheduled);
  expect(
    await c.command(c.humans[0]!.socket, 'room:create', {
      commandId: crypto.randomUUID(),
      capacity: 2,
      nickname: 'Other',
    }),
  ).toMatchObject({ ok: true });
  expect(c.room().hand).toBe(before);
  expect(c.clock.now()).toBe(0);
});
it('lets timeout win over a queued decision that cannot execute before its deadline', async () => {
  const c = await botContext({
    delayRandom: { next: () => 0 },
    policyRandom: { next: () => 0.99 },
  });
  contexts.push(c);
  const before = c.room().hand!;
  let release!: () => void;
  const gate = c.app.rooms.queue.run(c.roomId, () => new Promise<void>((r) => (release = r)));
  await Promise.resolve();
  c.clock.flush = () => Promise.resolve();
  try {
    await c.clock.advanceTo(30000);
  } finally {
    release();
  }
  await gate;
  await c.app.rooms.queue.idle();
  expect(c.room().hand!.handVersion).toBe(before.handVersion + 1);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:bot'")
      .get()?.n,
  ).toBe(0);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:timeout'")
      .get()?.n,
  ).toBe(1);
});
it('takes an immediate safe action when the remaining deadline is shorter than the requested display delay', async () => {
  const c = await botContext({ enabled: false });
  contexts.push(c);
  await c.clock.advanceTo(29999, false);
  const scheduler = new BotScheduler(c.app.rooms, c.clock, {
    delayRandom: { next: () => 0.999 },
    policyRandom: { next: () => 0 },
  });
  try {
    scheduler.sync(c.room());
    const before = c.room().hand!;
    await c.clock.advanceTo(29999);
    expect(c.room().hand!.handVersion).toBe(before.handVersion + 1);
    expect(scheduler.diagnostics.safeFallbacks).toBe(1);
  } finally {
    scheduler.close();
  }
});
it('does not arm a bot action if the native start transaction fails', async () => {
  const c = await lifecycleContext({ players: 1, bots: 3 });
  try {
    c.storage.raw.exec(
      "CREATE TRIGGER fail_bot_start BEFORE INSERT ON command_receipts WHEN NEW.event='room:start' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    await expect(c.start()).rejects.toThrow('PERSISTENCE_UNAVAILABLE');
    expect(c.app.bots.diagnostics.active).toBe(0);
    expect(c.clock.pending).toBe(0);
    expect(c.room().hand).toBeNull();
  } finally {
    await c.close();
  }
});
const contexts: Awaited<ReturnType<typeof botContext>>[] = [];
it('discards an already queued scheduler result when its job is cancelled before queue execution', async () => {
  const c = await botContext({
    delayRandom: { next: () => 0 },
    policyRandom: { next: () => 0.99 },
  });
  contexts.push(c);
  const before = c.room().hand;
  let release!: () => void;
  const gate = c.app.rooms.queue.run(c.roomId, () => new Promise<void>((r) => (release = r)));
  await Promise.resolve();
  c.clock.flush = () => Promise.resolve();
  try {
    await c.clock.advanceTo(500);
    c.app.bots.close();
  } finally {
    release();
  }
  await gate;
  await c.app.rooms.queue.idle();
  expect(c.room().hand).toBe(before);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:bot'")
      .get()?.n,
  ).toBe(0);
});
it('contains a callback clock failure by cancelling and pausing instead of escaping into the event loop', async () => {
  const c = await botContext({ delayRandom: { next: () => 0 } });
  contexts.push(c);
  const now = c.clock.now,
    before = c.room().hand;
  c.clock.now = () => {
    throw Error('fixture clock unavailable');
  };
  try {
    await expect(c.clock.advanceTo(500)).resolves.toBeUndefined();
  } finally {
    c.clock.now = now;
  }
  expect(c.room().row.status).toBe('pausedFault');
  expect(c.room().hand).toBe(before);
  expect(c.app.bots.diagnostics.active).toBe(0);
});
afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});
it('delays the real bot turn by 500 ms, applies once and preserves its original deadline', async () => {
  const c = await botContext({
    policyRandom: { next: () => 0.99 },
    delayRandom: { next: () => 0 },
  });
  contexts.push(c);
  const hand = c.room().hand!,
    deadline = c.observation().deadline;
  await c.clock.advanceTo(499);
  expect(c.room().hand).toBe(hand);
  await c.clock.advanceTo(500);
  expect(c.room().hand!.handVersion).toBe(hand.handVersion + 1);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:bot'")
      .get()?.n,
  ).toBe(1);
  expect(deadline).toBe(30000);
  expect(c.room().turnClock!.deadline).toBe(30500);
});
it('cancels a delayed bot turn on pause and close without posting an action', async () => {
  const c = await botContext({ delayRandom: { next: () => 0 } });
  contexts.push(c);
  const before = c.room().hand;
  c.app.rooms.pauseForFault(c.roomId);
  await c.clock.advanceTo(1500);
  expect(c.room().hand).toBe(before);
  expect(
    c.storage.raw
      .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:bot'")
      .get()?.n,
  ).toBe(0);
  await c.app.close();
  expect(c.clock.pending).toBe(0);
});
