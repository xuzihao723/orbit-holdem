import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import concurrently from 'concurrently';
import { spawnSync } from 'node:child_process';

try {
  const host = process.env.HOST ?? '127.0.0.1';
  const rawPort = process.env.PORT ?? '3001';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Development PORT must be an integer between 1 and 65535');
  }

  // Fail before starting a persistent watcher if this target belongs to another process.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen({ host, port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const args of [
    ['node_modules/typescript/bin/tsc', '-b', 'apps/server'],
    ['scripts/copy-server-assets.mjs'],
  ]) {
    const build = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (build.status !== 0) throw Error('Development server/worker compilation failed');
  }

  const group = concurrently(
    [
      {
        command:
          'node node_modules/typescript/bin/tsc -b apps/server --watch --preserveWatchOutput',
        name: 'compile',
      },
      {
        command: 'node --watch --watch-path=apps/server/dist apps/server/dist/index.js',
        name: 'runtime',
      },
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      raw: false,
      prefix: '',
      handleInput: true,
      killOthers: ['failure', 'success'],
    },
  );
  const command = group.commands[1];
  let output = '';
  let ready = false;
  const timer = setTimeout(() => {
    if (!ready) {
      console.error('Server did not become ready within 15 seconds; stopping its watcher.');
      for (const child of group.commands) child.kill('SIGTERM');
      process.exitCode = 1;
    }
  }, 15_000);
  const subscription = command.stdout.subscribe((chunk) => {
    output = (output + chunk.toString()).slice(-8192);
    if (/Orbit server \(protocol \d+\) listening at http:\/\//.test(output)) {
      ready = true;
      clearTimeout(timer);
    }
  });
  try {
    await group.result;
  } catch {
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    subscription.unsubscribe();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
