import { test, expect } from './timer.fixture.js';
import type { createSocketClient } from '../../apps/web/src/network/socket-client.js';
declare global {
  interface Window {
    w21Client: ReturnType<typeof createSocketClient>;
  }
}
test('real client receives a fixed deadline and display calibration does not restart it', async ({
  page,
}) => {
  await page.goto('/');
  expect(
    await page.evaluate(async () => {
      const path = '/src/network/socket-client.ts',
        m = await import(path);
      window.w21Client = m.createSocketClient();
      await window.w21Client.connect();
      return (await window.w21Client.guest('Timer')).ok;
    }),
  ).toBe(true);
  expect(
    (
      await page.evaluate(() =>
        window.w21Client.sendCommand('room:create', {
          commandId: crypto.randomUUID(),
          capacity: 2,
          nickname: 'Timer',
        }),
      )
    ).ok,
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.w21Client.store.snapshot.roomView?.roomId))
    .toBeTruthy();
  expect(
    (
      await page.evaluate(() => {
        const r = window.w21Client.store.snapshot.roomView!;
        return window.w21Client.sendCommand('room:bot:add', {
          commandId: crypto.randomUUID(),
          roomId: r.roomId,
          expectedRoomVersion: r.roomVersion,
          seatId: 1,
          difficulty: 'basic',
        });
      })
    ).ok,
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.w21Client.store.snapshot.roomView?.seats.filter((s) => s.occupant).length,
      ),
    )
    .toBe(2);
  expect(
    (
      await page.evaluate(() => {
        const r = window.w21Client.store.snapshot.roomView!;
        return window.w21Client.sendCommand('room:ready', {
          commandId: crypto.randomUUID(),
          roomId: r.roomId,
          expectedRoomVersion: r.roomVersion,
          ready: true,
        });
      })
    ).ok,
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.w21Client.store.snapshot.roomView?.canStart))
    .toBe(true);
  const payload = await page.evaluate(() => {
    const r = window.w21Client.store.snapshot.roomView!;
    return { commandId: crypto.randomUUID(), roomId: r.roomId, expectedRoomVersion: r.roomVersion };
  });
  expect(
    (await page.evaluate((p) => window.w21Client.sendCommand('room:start', p), payload)).ok,
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.w21Client.store.snapshot.playerView?.deadline))
    .toBeGreaterThan(0);
  const before = await page.evaluate(() => window.w21Client.store.snapshot.playerView!);
  expect(
    (await page.evaluate((p) => window.w21Client.sendCommand('room:start', p), payload)).duplicate,
  ).toBe(true);
  const after = await page.evaluate(() => window.w21Client.store.snapshot.playerView!);
  expect(after.deadline).toBe(before.deadline);
  expect(after.turnId).toBe(before.turnId);
  const display = await page.evaluate(async (v) => {
    const path = '/src/network/server-clock.ts',
      m = await import(path),
      clock = new m.ServerTimeClock();
    clock.observe(v.serverTime, 1000);
    const first = clock.remainingMs(v.deadline, 1000),
      later = clock.remainingMs(v.deadline, 6000);
    clock.observe(v.serverTime, 6000);
    return { first, later, repeated: clock.remainingMs(v.deadline, 6000) };
  }, before);
  expect(display.first).toBeGreaterThan(29000);
  expect(display.first - display.later).toBe(5000);
  expect(display.repeated).toBe(display.later);
  expect(
    await page.evaluate(async () => {
      window.w21Client.disconnect();
      try {
        await window.w21Client.sendCommand('room:leave', {
          commandId: crypto.randomUUID(),
          roomId: 'offline',
        });
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await page.evaluate(() => window.w21Client.close());
});
