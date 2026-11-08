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
export const test = base.extend<{}, { network: ApplicationRuntime }>({
  network: [
    async ({}, use) => {
      const directory = mkdtempSync(join(tmpdir(), 'orbit-w22-browser-'));
      const app = createApplicationRuntime({ databasePath: join(directory, 'network.sqlite') }),
        server = createPokerServer({ port: 3001, application: app });
      try {
        await server.listen();
        await use(app);
      } finally {
        await server.close();
        await app.close();
        assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
        assert.ok(basename(directory).startsWith('orbit-w22-browser-'));
        rmSync(directory, { recursive: true, force: true });
      }
    },
    { scope: 'worker', auto: true },
  ],
});
export { expect };
