import type { ServerMeta } from '@orbit/protocol';
import { createPokerServer } from './create-server.js';
import { createApplicationRuntime, type ApplicationRuntime } from './application-runtime.js';

import { persistenceConfig } from './persistence/config.js';
import { PersistenceError } from './persistence/errors.js';
import { parseRuntimeConfig } from './config/runtime-config.js';
import { authOptions } from './auth/delivery.js';
import { googleSignIn } from './auth/google.js';

const protocolVersion: ServerMeta['protocolVersion'] = 1;
const configuredPort = process.env.PORT;
if (configuredPort !== undefined && !/^\d+$/.test(configuredPort)) {
  console.error('PORT must contain only digits');
  process.exitCode = 1;
} else {
  let runtime: ApplicationRuntime | undefined,
    server: ReturnType<typeof createPokerServer> | undefined,
    closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      try {
        await server?.close();
      } finally {
        await runtime?.close();
      }
    })());
  const describe = (error: unknown) =>
    error instanceof PersistenceError
      ? error.code
      : error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE'
        ? 'EADDRINUSE'
        : 'SERVER_START_FAILED';
  try {
    const config = parseRuntimeConfig();
    const accounts = authOptions(process.env, config.host, config.webOrigin);
    const google = googleSignIn(process.env, config.webOrigin);
    runtime = createApplicationRuntime({ databasePath: config.databasePath });
    server = createPokerServer({
      host: config.host,
      port: config.port,
      webOrigin: config.webOrigin,
      ...(config.guestWebOrigin ? { guestWebOrigin: config.guestWebOrigin } : {}),
      ...(config.webDist ? { webDist: config.webDist } : {}),
      application: runtime,
      ...(accounts ? { accounts } : {}),
      ...(google ? { google } : {}),
    });
    const shutdown = () => {
      void close().catch(() => {
        console.error('SERVER_SHUTDOWN_FAILED');
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    const address = await server.listen();
    console.info(`Orbit server (protocol ${protocolVersion}) listening at ${address.origin}`);
  } catch (error) {
    console.error(describe(error));
    await close();
    process.exitCode = 1;
  }
}
