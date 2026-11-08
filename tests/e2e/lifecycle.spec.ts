import { test, expect } from './lifecycle.fixture.js';
import { bootProbe as boot, installProbePage, probePath } from '../helpers/browser-resume-probe.js';
test('module-driven lifecycle refresh, takeover, next hand and actor exit keep identity and settled balances', async ({
  browser,
  network,
}) => {
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  try {
    await Promise.all([installProbePage(ca), installProbePage(cb)]);
    const a = await ca.newPage(),
      b = await cb.newPage();
    await a.goto(probePath);
    await b.goto(probePath);
    expect(await boot(a, 'A')).toBe(true);
    expect(await boot(b, 'B')).toBe(true);
    const made = await a.evaluate(() =>
      window.w22Client.sendCommand('room:create', {
        commandId: crypto.randomUUID(),
        capacity: 2,
        nickname: 'A',
      }),
    );
    expect(made.ok).toBe(true);
    if (!made.ok) throw Error(made.code);
    const roomId = made.roomId;
    await expect
      .poll(() => a.evaluate(() => window.w22Client.store.snapshot.roomView?.roomId))
      .toBe(roomId);
    const code = await a.evaluate(() => window.w22Client.store.snapshot.roomView!.roomCode);
    expect(
      (
        await b.evaluate(
          (roomCode) =>
            window.w22Client.sendCommand('room:join', {
              commandId: crypto.randomUUID(),
              roomCode,
              nickname: 'B',
            }),
          code,
        )
      ).ok,
    ).toBe(true);
    for (const p of [a, b])
      await expect
        .poll(() =>
          p.evaluate(
            () => window.w22Client.store.snapshot.roomView?.seats.filter((s) => s.occupant).length,
          ),
        )
        .toBe(2);
    for (const [i, p] of [a, b].entries()) {
      expect(
        (
          await p.evaluate(() => {
            const r = window.w22Client.store.snapshot.roomView!;
            return window.w22Client.sendCommand('room:ready', {
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
              window.w22Client.store.snapshot.roomView?.seats.filter(
                (s) => s.occupant?.ready === true,
              ).length,
          ),
        )
        .toBe(i + 1);
    }
    expect(
      (
        await a.evaluate(() => {
          const r = window.w22Client.store.snapshot.roomView!;
          return window.w22Client.sendCommand('room:start', {
            commandId: crypto.randomUUID(),
            roomId: r.roomId,
            expectedRoomVersion: r.roomVersion,
          });
        })
      ).ok,
    ).toBe(true);
    for (const p of [a, b])
      await expect
        .poll(() => p.evaluate(() => window.w22Client.store.snapshot.playerView?.handVersion))
        .toBe(1);
    const initial = await a.evaluate(() => window.w22Client.store.snapshot.playerView!);
    await a.reload();
    expect(await boot(a)).toBe(true);
    const restored = await a.evaluate(() => window.w22Client.store.snapshot.playerView!);
    expect(restored.self.participantId).toBe(initial.self.participantId);
    expect(restored.self.holeCards).toEqual(initial.self.holeCards);
    expect(restored.deadline).toBe(initial.deadline);
    await ca.setOffline(true);
    // Browser offline mode can leave existing WebSockets alive.
    expect(await a.evaluate(() => window.dropResumeProbeSockets())).toBe(1);
    await expect
      .poll(() => a.evaluate(() => window.w22Client.store.snapshot.status), { timeout: 10000 })
      .toBe('disconnected');
    await ca.setOffline(false);
    await expect
      .poll(() => a.evaluate(() => window.w22Client.store.snapshot.controlReady), {
        timeout: 15000,
      })
      .toBe(true);
    expect(
      await a.evaluate(() => window.w22Client.store.snapshot.playerView!.self.participantId),
    ).toBe(initial.self.participantId);
    const views = await Promise.all(
        [a, b].map((p) => p.evaluate(() => window.w22Client.store.snapshot.playerView!)),
      ),
      index = views.findIndex((v) => v.self.legalActions.allowed.includes('fold'));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(
      (
        await [a, b][index]!.evaluate(() => {
          const v = window.w22Client.store.snapshot.playerView!;
          return window.w22Client.sendCommand('game:action', {
            commandId: crypto.randomUUID(),
            roomId: v.roomId,
            handId: v.handId,
            turnId: v.turnId!,
            expectedVersion: v.handVersion,
            action: { type: 'fold' },
          });
        })
      ).ok,
    ).toBe(true);
    for (const p of [a, b])
      await expect
        .poll(() => p.evaluate(() => window.w22Client.store.snapshot.result?.phase))
        .toBe('settled');
    await b.reload();
    expect(await boot(b)).toBe(true);
    await expect
      .poll(() => b.evaluate(() => window.w22Client.store.snapshot.result?.phase))
      .toBe('settled');
    expect(network.rooms.store.get(roomId)!.participants.reduce((n, p) => n + p.stack, 0)).toBe(
      4000,
    );
    const takeover = await ca.newPage();
    await takeover.goto(probePath);
    expect(await boot(takeover)).toBe(true);
    await expect
      .poll(() => a.evaluate(() => window.w22Client.store.snapshot.status))
      .toBe('takenOver');
    expect(await a.evaluate(() => window.w22Client.connected)).toBe(true);
    expect(
      await takeover.evaluate(() => window.w22Client.store.snapshot.authContext!.participantId),
    ).toBe(initial.self.participantId);
    const oldHand = network.rooms.store.get(roomId)!.hand!.handId;
    for (const [i, p] of [takeover, b].entries()) {
      expect(
        (
          await p.evaluate(() => {
            const r = window.w22Client.store.snapshot.roomView!;
            return window.w22Client.sendCommand('room:ready', {
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
          takeover.evaluate(
            () =>
              window.w22Client.store.snapshot.roomView?.seats.filter(
                (s) => s.occupant?.ready === true,
              ).length,
          ),
        )
        .toBe(i + 1);
    }
    expect(
      (
        await takeover.evaluate(() => {
          const r = window.w22Client.store.snapshot.roomView!;
          return window.w22Client.sendCommand('room:start', {
            commandId: crypto.randomUUID(),
            roomId: r.roomId,
            expectedRoomVersion: r.roomVersion,
          });
        })
      ).ok,
    ).toBe(true);
    for (const p of [takeover, b])
      await expect
        .poll(() => p.evaluate(() => window.w22Client.store.snapshot.playerView?.handId))
        .not.toBe(oldHand);
    const bOwner = await b.evaluate(
      () => window.w22Client.store.snapshot.playerView!.self.participantId,
    );
    await b.reload();
    expect(await boot(b)).toBe(true);
    expect(
      await b.evaluate(() => window.w22Client.store.snapshot.playerView!.self.participantId),
    ).toBe(bOwner);
    const live = [takeover, b],
      actorViews = await Promise.all(
        live.map((p) => p.evaluate(() => window.w22Client.store.snapshot.playerView!)),
      ),
      leaver = actorViews.findIndex((v) => v.self.legalActions.allowed.includes('fold'));
    expect(leaver).toBeGreaterThanOrEqual(0);
    expect(
      (
        await live[leaver]!.evaluate(() =>
          window.w22Client.sendCommand('room:leave', {
            commandId: crypto.randomUUID(),
            roomId: window.w22Client.store.snapshot.roomView!.roomId,
          }),
        )
      ).ok,
    ).toBe(true);
    await expect.poll(() => network.rooms.store.get(roomId)!.hand!.phase).toBe('settled');
    const state = network.rooms.store.get(roomId)!,
      leaving = state.participants.find(
        (p) => p.participantId === actorViews[leaver]!.self.participantId,
      )!;
    expect(leaving.stack).toBe(0);
    expect(leaving.leftAt).not.toBeNull();
    expect(state.hand!.players.reduce((n, p) => n + p.stack, 0)).toBe(4000);
    for (const p of [a, b, takeover])
      await p.evaluate(() => {
        window.w22Recovery.close();
        window.w22Client.close();
      });
  } finally {
    await ca.close();
    await cb.close();
  }
});
