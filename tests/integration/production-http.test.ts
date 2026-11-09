import { expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createPokerServer } from '../../apps/server/src/create-server.js';
test('exposes readiness to the deployed guest web origin only', async () => {
  const guestWebOrigin = 'https://orbit-holdem.vercel.app';
  const server = createPokerServer({ port: 0, guestWebOrigin, healthReady: () => true });
  try {
    const { origin } = await server.listen();
    const guest = { headers: { Origin: guestWebOrigin } };
    const ready = await fetch(origin + '/health/ready', guest);
    expect(ready.headers.get('access-control-allow-origin')).toBe(guestWebOrigin);
    expect(await ready.json()).toEqual({ status: 'ready' });
    const other = { headers: { Origin: 'https://other.example' } };
    expect(
      (await fetch(origin + '/health/ready', other)).headers.has('access-control-allow-origin'),
    ).toBe(false);
    expect(
      (await fetch(origin + '/health/live', guest)).headers.has('access-control-allow-origin'),
    ).toBe(false);
  } finally {
    await server.close();
  }
});

test('real server serves same-origin SPA, immutable assets, HEAD and ready without exposing data paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-http-')),
    web = join(dir, 'web');
  mkdirSync(join(web, 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), '<html>actual SPA</html>');
  writeFileSync(join(web, 'assets', 'index-abcd.js'), 'console.log(1)');
  writeFileSync(join(dir, 'private.sqlite'), 'private');
  const server = createPokerServer({ port: 0, webDist: web, healthReady: () => true });
  try {
    const { origin } = await server.listen();
    for (const path of ['/', '/rules', '/history', '/history/test-hand', '/room/ABC234']) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('actual SPA');
    }
    const asset = await fetch(origin + '/assets/index-abcd.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(origin + '/health/ready')).status).toBe(200);
    expect(await (await fetch(origin + '/rules', { method: 'HEAD' })).text()).toBe('');
    for (const path of [
      '/assets/missing.js',
      '/.env',
      '/private.sqlite',
      '/%2e%2e%2fprivate.sqlite',
      '/assets/%00x.js',
    ])
      expect((await fetch(origin + path)).status).toBeGreaterThanOrEqual(400);
  } finally {
    await server.close();
    expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));
    rmSync(dir, { recursive: true });
  }
});
