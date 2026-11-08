import { resolve, sep } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { persistenceConfig } from '../persistence/config.js';
export function parseRuntimeConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const production = env.NODE_ENV === 'production';
  if (env.PORT !== undefined && !/^\d+$/.test(env.PORT)) throw Error('INVALID_PORT');
  const port = env.PORT === undefined ? 3001 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('INVALID_PORT');
  if (production && !env.WEB_ORIGIN) throw Error('PRODUCTION_ORIGIN_REQUIRED');
  const webOrigin = env.WEB_ORIGIN ?? 'http://127.0.0.1:5173';
  const origin = new URL(webOrigin);
  if (
    origin.origin !== webOrigin ||
    origin.username ||
    origin.password ||
    (production && origin.protocol !== 'https:')
  )
    throw Error('INVALID_WEB_ORIGIN');
  const databasePath = persistenceConfig(env, cwd).path;
  if (production && !env.WEB_DIST) throw Error('PRODUCTION_WEB_DIST_REQUIRED');
  const webDist = env.WEB_DIST ? resolve(cwd, env.WEB_DIST) : undefined;
  if (webDist && (databasePath === webDist || databasePath.startsWith(webDist + sep)))
    throw Error('DATA_INSIDE_WEB_DIST');
  if (
    webDist &&
    (!existsSync(resolve(webDist, 'index.html')) ||
      !statSync(resolve(webDist, 'index.html')).isFile())
  )
    throw Error('WEB_DIST_MISSING');
  return {
    port,
    host: env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1'),
    webOrigin,
    databasePath,
    webDist,
  };
}
