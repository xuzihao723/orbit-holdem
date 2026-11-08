import { lifecycleContext } from './lifecycle-context.js';
import type { WorkerPoolOptions } from '../../apps/server/src/bots/worker-pool.js';
export async function standardContext(
  workerPoolOptions: WorkerPoolOptions = { size: 1, budgetMs: 500 },
) {
  const c = await lifecycleContext({
    players: 1,
    bots: 1,
    difficulty: 'standard',
    botOptions: { delayRandom: { next: () => 0 }, policyRandom: { next: () => 0.99 } },
    workerPoolOptions,
  });
  try {
    await c.start();
    const h = c.room().hand!;
    const ack = await c.command(c.humans[0]!.socket, 'game:action', {
      commandId: crypto.randomUUID(),
      roomId: c.roomId,
      handId: h.handId,
      turnId: h.turnId!,
      expectedVersion: h.handVersion,
      action: { type: 'call' },
    });
    if (!ack.ok) throw Error(ack.code);
    await c.clock.advanceTo(500);
    return c;
  } catch (e) {
    await c.close();
    throw e;
  }
}
