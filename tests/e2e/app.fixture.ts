import { test as base, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import {
  createApplicationRuntime,
  type ApplicationRuntime,
} from '../../apps/server/dist/application-runtime.js';
import { createPokerServer } from '../../apps/server/dist/create-server.js';
import type { AuthenticatedCommand } from '../../apps/server/dist/transport/types.js';
import { FakeClock } from '../helpers/fake-clock.js';
interface Faults {
  commands: { event: string; commandId: string }[];
  dropEvent: string | null;
  dropNth: number;
  seen: number;
  release: (() => void) | null;
}
export const test = base.extend<
  {},
  { network: ApplicationRuntime; clock: FakeClock; faults: Faults }
>({
  clock: [
    async ({}, use) => {
      await use(new FakeClock());
    },
    { scope: 'worker' },
  ],
  faults: [
    async ({}, use) => {
      const f: Faults = { commands: [], dropEvent: null, dropNth: 1, seen: 0, release: null };
      try {
        await use(f);
      } finally {
        f.release?.();
      }
    },
    { scope: 'worker' },
  ],
  network: [
    async ({ clock, faults }, use) => {
      const dir = mkdtempSync(join(tmpdir(), 'orbit-app-browser-')),
        app = createApplicationRuntime({
          databasePath: join(dir, 'network.sqlite'),
          serverClock: clock,
        });
      clock.flush = async () => {
        await app.rooms.queue.idle();
        await new Promise<void>((r) => setImmediate(r));
      };
      const high = { connection: 1000, session: 1000, ip: 10000, windowMs: 1000 };
      const server = createPokerServer({
        port: 3001,
        webOrigin: 'http://127.0.0.1:4173',
        application: app,
        transport: {
          now: clock.now,
          limits: {
            admission: high,
            management: high,
            action: high,
            global: high,
            identity: { ...high, session: 0 },
          },
        },
        executor: {
          execute: async (c: AuthenticatedCommand) => {
            faults.commands.push({ event: c.event, commandId: c.payload.commandId });
            const ack = await app.rooms.execute(c);
            if (c.event === faults.dropEvent && ++faults.seen === faults.dropNth) {
              faults.dropEvent = null;
              await new Promise<void>((r) => {
                faults.release = r;
              });
            }
            return ack;
          },
          afterAck: (c, ack) => app.rooms.afterAck(c, ack),
        },
      });
      try {
        await server.listen();
        await use(app);
      } finally {
        faults.release?.();
        await server.close();
        await app.close();
        assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
        assert.ok(basename(dir).startsWith('orbit-app-browser-'));
        rmSync(dir, { recursive: true });
      }
    },
    { scope: 'worker', auto: true },
  ],
});
export { expect };
