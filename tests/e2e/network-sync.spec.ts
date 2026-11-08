import { test, expect } from './network.fixture.js';
import type { Page } from '@playwright/test';
import type { createSocketClient } from '../../apps/web/src/network/socket-client.js';
declare global {
  interface Window {
    w20Client: ReturnType<typeof createSocketClient>;
  }
}
async function boot(page: Page, name: string) {
  await page.goto('/');
  return page.evaluate(async (name) => {
    const path = '/src/network/socket-client.ts',
      module = await import(path);
    window.w20Client = module.createSocketClient();
    await window.w20Client.connect();
    const issued = await window.w20Client.guest(name);
    return issued.ok;
  }, name);
}
test('two isolated browsers run the real client through duplicate action, showdown and takeover', async ({
  browser,
  network,
}) => {
  const contextA = await browser.newContext(),
    contextB = await browser.newContext();
  try {
    const a = await contextA.newPage(),
      b = await contextB.newPage();
    expect(await boot(a, 'A')).toBe(true);
    expect(await boot(b, 'B')).toBe(true);
    const made = await a.evaluate(() =>
      window.w20Client.sendCommand('room:create', {
        commandId: crypto.randomUUID(),
        nickname: 'A',
        capacity: 2,
      }),
    );
    expect(made.ok).toBe(true);
    if (!made.ok) throw Error(made.code);
    const roomId = made.roomId;
    await expect
      .poll(() => a.evaluate(() => window.w20Client.store.snapshot.roomView?.roomCode))
      .toBeTruthy();
    const code = await a.evaluate(() => window.w20Client.store.snapshot.roomView!.roomCode);
    expect(
      (
        await b.evaluate(
          (roomCode) =>
            window.w20Client.sendCommand('room:join', {
              commandId: crypto.randomUUID(),
              roomCode,
              nickname: 'B',
            }),
          code,
        )
      ).ok,
    ).toBe(true);
    for (const page of [a, b]) {
      await expect
        .poll(() => page.evaluate(() => window.w20Client.store.snapshot.roomView?.roomId))
        .toBe(roomId);
      expect(
        (
          await page.evaluate(() => {
            const r = window.w20Client.store.snapshot.roomView!;
            return window.w20Client.sendCommand('room:ready', {
              commandId: crypto.randomUUID(),
              roomId: r.roomId,
              expectedRoomVersion: r.roomVersion,
              ready: true,
            });
          })
        ).ok,
      ).toBe(true);
      await expect
        .poll(() =>
          a.evaluate(
            () =>
              window.w20Client.store.snapshot.roomView?.seats.filter(
                (s) => s.occupant?.ready === true,
              ).length,
          ),
        )
        .toBe(page === a ? 1 : 2);
    }
    expect(
      (
        await a.evaluate(() => {
          const r = window.w20Client.store.snapshot.roomView!;
          return window.w20Client.sendCommand('room:start', {
            commandId: crypto.randomUUID(),
            roomId: r.roomId,
            expectedRoomVersion: r.roomVersion,
          });
        })
      ).ok,
    ).toBe(true);
    for (const page of [a, b])
      await expect
        .poll(() => page.evaluate(() => window.w20Client.store.snapshot.playerView?.handVersion))
        .toBe(1);
    const ownA = await a.evaluate(
        () => window.w20Client.store.snapshot.playerView!.self.holeCards!,
      ),
      ownB = await b.evaluate(() => window.w20Client.store.snapshot.playerView!.self.holeCards!);
    expect(ownA).toHaveLength(2);
    expect(ownB).toHaveLength(2);
    const jsonA = await a.evaluate(() => JSON.stringify(window.w20Client.store.snapshot));
    for (const card of ownB) expect(jsonA).not.toContain('"' + card + '"');
    expect(jsonA).not.toContain('resumeToken');
    let count = 0;
    while (count < 30) {
      const views = await Promise.all(
        [a, b].map((p) => p.evaluate(() => window.w20Client.store.snapshot.playerView!)),
      );
      if (views[0]!.phase === 'settled') break;
      const index = views.findIndex((v) => v.self.legalActions.allowed.length > 0);
      expect(index).toBeGreaterThanOrEqual(0);
      const actor = [a, b][index]!,
        version = views[index]!.handVersion;
      const acks = await actor.evaluate(async (duplicate) => {
        const client = window.w20Client,
          v = client.store.snapshot.playerView!,
          allowed = v.self.legalActions.allowed,
          type = allowed.includes('check') ? 'check' : allowed.includes('call') ? 'call' : 'allIn',
          payload = {
            commandId: crypto.randomUUID(),
            roomId: v.roomId,
            handId: v.handId,
            turnId: v.turnId!,
            expectedVersion: v.handVersion,
            action: { type } as const,
          };
        return duplicate
          ? Promise.all([
              client.sendCommand('game:action', payload),
              client.sendCommand('game:action', payload),
            ])
          : [await client.sendCommand('game:action', payload)];
      }, count === 0);
      expect(acks.every((ack) => ack.ok)).toBe(true);
      if (count === 0) expect(acks.filter((ack) => ack.duplicate)).toHaveLength(1);
      for (const page of [a, b])
        await expect
          .poll(() => page.evaluate(() => window.w20Client.store.snapshot.playerView?.handVersion))
          .toBe(version + 1);
      count++;
    }
    expect(count).toBeLessThan(30);
    for (const page of [a, b]) {
      await expect
        .poll(() => page.evaluate(() => window.w20Client.store.snapshot.result?.phase))
        .toBe('settled');
      const state = await page.evaluate(() => window.w20Client.store.snapshot);
      expect(state.playerView!.potTotal).toBe(0);
      expect(state.playerView!.players.reduce((n, p) => n + p.stack, 0)).toBe(4000);
      expect(state.result!.finalStacks.map((p) => p.stack)).toEqual(
        state.playerView!.players.map((p) => p.stack),
      );
    }
    expect(network.rooms.store.get(roomId)!.hand!.settlementCount).toBe(1);
    const takeover = await contextA.newPage();
    await takeover.goto('/');
    const resumed = await takeover.evaluate(async () => {
      const path = '/src/network/socket-client.ts',
        module = await import(path);
      window.w20Client = module.createSocketClient();
      await window.w20Client.connect();
      const r = await window.w20Client.resume();
      return { ok: r.ok, outcome: r.ok ? r.outcome : null };
    });
    expect(resumed).toEqual({ ok: true, outcome: 'seatRestored' });
    await expect
      .poll(() => a.evaluate(() => window.w20Client.store.snapshot.status))
      .toBe('takenOver');
    expect(await a.evaluate(() => window.w20Client.connected)).toBe(true);
    expect(
      await a.evaluate(async () => {
        try {
          await window.w20Client.sendCommand('room:create', {
            commandId: crypto.randomUUID(),
            capacity: 2,
            nickname: 'A',
          });
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    expect(
      (
        await takeover.evaluate(
          (roomCode) =>
            window.w20Client.sendCommand('room:join', {
              commandId: crypto.randomUUID(),
              roomCode,
              nickname: 'A',
            }),
          code,
        )
      ).ok,
    ).toBe(true);
    await expect
      .poll(() => takeover.evaluate(() => window.w20Client.store.snapshot.playerView?.phase))
      .toBe('settled');
    expect(network.rooms.store.get(roomId)!.participants.reduce((n, p) => n + p.stack, 0)).toBe(
      4000,
    );
    for (const page of [a, b, takeover]) await page.evaluate(() => window.w20Client.close());
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
