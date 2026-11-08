const stage = process.env.ORBIT_VERIFY_STAGE ?? 'scratch';
import { test, expect } from './release.fixture';
import { createUiRoom, joinUiRoom, startUiHand, finishUiHand } from '../helpers/ui-hand-driver';
import { io } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
for (const profile of ['rtt100', 'rtt300'] as const)
  test(
    profile + ' imposes real round-trip latency and still completes the browser hand',
    async ({ page, browser, network, clock, faults }) => {
      faults.proxy!.setProfile(profile);
      const socket = io('http://127.0.0.1:4173', {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      const times: number[] = [];
      try {
        await new Promise<void>((r, j) => {
          socket.once('connect', r);
          socket.once('connect_error', j);
        });
        const guest = await new Promise<{ ok: boolean }>((resolve) =>
          socket.emit('session:guest', { requestId: randomUUID(), nickname: '延迟探针' }, resolve),
        );
        expect(guest.ok).toBe(true);
        for (let i = 0; i < 3; i++) {
          const start = performance.now();
          await new Promise((resolve) =>
            socket.emit('history:list', { requestId: randomUUID(), cursor: null }, resolve),
          );
          times.push(performance.now() - start);
        }
        expect(Math.min(...times)).toBeGreaterThanOrEqual(profile === 'rtt100' ? 90 : 280);
        const context = await browser.newContext(),
          other = await context.newPage();
        try {
          const code = await createUiRoom(page);
          await joinUiRoom(other, code, 1);
          await startUiHand([page, other]);
          await finishUiHand(network, clock, code, [page, other]);
          writeFileSync(
            'docs/verification/' + stage + '-' + profile + '.json',
            JSON.stringify(
              {
                profile,
                clock: 'wall',
                roundTripsMs: times,
                stats: faults.proxy!.stats,
                completedUiHand: true,
              },
              null,
              2,
            ) + '\n',
          );
        } finally {
          await context.close();
        }
      } finally {
        socket.disconnect();
        faults.proxy!.setProfile('base');
      }
    },
  );
test('drops a real committed action acknowledgement, then survives a genuine five-second offline interval', async ({
  page,
  browser,
  network,
  faults,
}) => {
  const context = await browser.newContext(),
    other = await context.newPage();
  try {
    const code = await createUiRoom(page);
    await joinUiRoom(other, code, 1);
    await startUiHand([page, other]);
    const hand = network.rooms.store.findCode(code)!.hand!,
      actor = hand.betting!.actorSeatId === 0 ? page : other;
    faults.proxy!.dropNextActionAck();
    await actor.getByLabel('加注至', { exact: true }).fill('100');
    await actor.getByRole('button', { name: '加注至 100', exact: true }).click();
    await expect.poll(() => faults.proxy!.stats.droppedAcks).toBeGreaterThan(0);
    await expect
      .poll(() => network.rooms.store.findCode(code)!.hand!.handVersion)
      .toBe(hand.handVersion + 1);
    await expect(actor.getByRole('alert')).toBeVisible({ timeout: 8000 });
    await expect(actor.getByRole('button', { name: '原请求重试', exact: true })).toHaveCount(0);
    const identity = await actor.evaluate(
        () => JSON.parse(localStorage.getItem('orbit.credentials')!).sessionId,
      ),
      start = performance.now();
    await actor.context().setOffline(true);
    await expect(actor.getByText('连接已断开，操作暂不可用。', { exact: false })).toBeVisible();
    // This wait is the measured wall-clock fault itself, never a substitute for a state assertion.
    await new Promise((r) => setTimeout(r, 5000));
    await actor.context().setOffline(false);
    await expect(actor.locator('.live-table')).toHaveAttribute(
      'data-hand-version',
      String(hand.handVersion + 1),
      { timeout: 10000 },
    );
    expect(
      await actor.evaluate(() => JSON.parse(localStorage.getItem('orbit.credentials')!).sessionId),
    ).toBe(identity);
    expect(network.rooms.store.findCode(code)!.hand!.handVersion).toBe(hand.handVersion + 1);
    writeFileSync(
      'docs/verification/' + stage + '-network-loss.json',
      JSON.stringify(
        {
          clock: 'wall',
          offlineElapsedMs: performance.now() - start,
          stats: faults.proxy!.stats,
          duplicateChipChange: false,
          identityPreserved: true,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await context.close();
  }
});
