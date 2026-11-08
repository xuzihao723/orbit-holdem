import { expect, it } from 'vitest';
import { lifecycleContext } from '../helpers/lifecycle-context.js';
import { waitUntil } from '../helpers/reconnect-context.js';
it('finishes a real scheduled mixed hand after all humans disconnect, then waits for the final reservation before closing', async () => {
  const c = await lifecycleContext({
    players: 2,
    bots: 2,
    botOptions: { policyRandom: { next: () => 0.99 }, delayRandom: { next: () => 0 } },
  });
  try {
    await c.start();
    c.humans[0]!.socket.disconnect();
    await waitUntil(() => !c.app.sessions.registry.getCurrent(c.humans[0]!.sessionId));
    await c.clock.advanceTo(10000);
    c.humans[1]!.socket.disconnect();
    await waitUntil(() => !c.app.sessions.registry.getCurrent(c.humans[1]!.sessionId));
    await c.clock.advanceTo(70000);
    expect(c.room().hand!.phase).toBe('settled');
    expect(c.room().hand!.players.reduce((n, p) => n + p.stack, 0)).toBe(8000);
    expect(c.app.bots.diagnostics.applied).toBeGreaterThan(0);
    const handId = c.room().hand!.handId;
    await c.clock.advanceTo(129999);
    expect(c.room().row.status).not.toBe('closed');
    expect(c.room().hand!.handId).toBe(handId);
    await c.clock.advanceTo(130000);
    expect(c.room().row.status).toBe('closed');
    expect(c.storage.raw.prepare('SELECT COUNT(*) n FROM hands').get()?.n).toBe(1);
    expect(c.app.bots.diagnostics.active).toBe(0);
  } finally {
    await c.close();
  }
});
