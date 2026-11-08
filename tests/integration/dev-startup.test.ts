import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
const ownedDirectories: string[] = [];
afterEach(() => {
  for (const directory of ownedDirectories.splice(0)) {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('orbit-dev-test-'))
      throw new Error('UNSAFE_TEST_CLEANUP');
    rmSync(target, { recursive: true, force: true });
  }
});

async function reserve(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing reserved TCP port');
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function startDev(port: number) {
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run this integration suite through npm');
  const directory = mkdtempSync(join(tmpdir(), 'orbit-dev-test-')),
    databasePath = join(directory, 'test.sqlite');
  ownedDirectories.push(directory);
  const child = spawn(process.execPath, [npm, 'run', 'dev'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: databasePath },
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });
  return { child, exited, output: () => output, databasePath };
}

async function stopOwnedProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve(),
      );
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error;
    }
  }
}

async function expectPortFree(port: number) {
  await expect
    .poll(
      async () => {
        try {
          const check = await reserve(port);
          await check.close();
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 3000 },
    )
    .toBe(true);
}

it('the actual unified dev command exits when its backend port is occupied', async () => {
  const front = await reserve(5173);
  await front.close();
  const occupied = await reserve(0);
  const processUnderTest = startDev(occupied.port);
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      processUnderTest.exited,
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), 8000);
      }),
    ]);
    expect(outcome, processUnderTest.output()).not.toBe('timeout');
    expect(outcome).not.toBe(0);
    expect(processUnderTest.output()).toContain('EADDRINUSE');
  } finally {
    if (timer) clearTimeout(timer);
    await stopOwnedProcess(processUnderTest.child);
    await processUnderTest.exited;
    await occupied.close();
  }
  await expectPortFree(5173);
}, 20_000);

it('the actual unified dev command starts both services and releases them when stopped', async () => {
  for (const port of [3001, 5173]) {
    const check = await reserve(port);
    await check.close();
  }
  const processUnderTest = startDev(3001);
  try {
    await expect
      .poll(
        async () => {
          try {
            const responses = await Promise.all([
              fetch('http://127.0.0.1:3001/health/live', { signal: AbortSignal.timeout(500) }),
              fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(500) }),
            ]);
            return responses.every((response) => response.status === 200);
          } catch {
            return false;
          }
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    expect(existsSync(processUnderTest.databasePath)).toBe(true);
  } catch (error) {
    throw new Error(
      ['DEV_STARTUP_FAILED', processUnderTest.output()].join(String.fromCharCode(10)),
      { cause: error },
    );
  } finally {
    await stopOwnedProcess(processUnderTest.child);
    await processUnderTest.exited;
  }
  for (const port of [3001, 5173]) await expectPortFree(port);
}, 30_000);
