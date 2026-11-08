import { resolve } from 'node:path';
import { PersistenceError } from './errors.js';
import type { PersistenceConfig } from './rows.js';
export function persistenceConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): PersistenceConfig {
  const value = env.DATABASE_PATH ?? '.data/orbit.sqlite';
  if (!value.trim() || value === ':memory:' || value.includes('\0'))
    throw new PersistenceError('PERSISTENCE_INVALID_INPUT');
  return Object.freeze({ path: resolve(cwd, value), busyTimeoutMs: 1000 });
}
