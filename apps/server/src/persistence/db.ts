import { archivePreviousEpoch } from './restart-archive.js';
import { commitBoundary } from './boundary-commit.js';
import { commitHandAction } from './hand-action-commit.js';
import type { HandActionCommit } from './hand-rows.js';
import type { HandStartCommit } from './hand-rows.js';
import { commitHandStart } from './hand-start-commit.js';
import { readHand } from './hand-repository.js';
import { roomRepository } from './room-repository.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate } from './migrate.js';
import { createRepositories } from './repositories.js';
import { accountRepository } from './account-repository.js';
import { databaseError, invalid } from './errors.js';
import type { PersistenceConfig, PokerDatabase } from './rows.js';
export type { PersistenceConfig, PokerDatabase } from './rows.js';
export function openDatabase(config: PersistenceConfig): PokerDatabase {
  let native: DatabaseSync | undefined;
  try {
    if (
      !config ||
      typeof config.path !== 'string' ||
      !config.path.trim() ||
      config.path.includes('\0') ||
      !Number.isSafeInteger(config.busyTimeoutMs) ||
      config.busyTimeoutMs < 0 ||
      config.busyTimeoutMs > 10000 ||
      (config.readOnly !== undefined && typeof config.readOnly !== 'boolean')
    )
      invalid();
    if (config.path !== ':memory:' && !config.readOnly)
      mkdirSync(dirname(config.path), { recursive: true });
    native = new DatabaseSync(config.path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      readOnly: config.readOnly ?? false,
      allowExtension: false,
    });
    const db = native;
    db.exec(`PRAGMA busy_timeout=${config.busyTimeoutMs}`);
    db.exec('PRAGMA foreign_keys=ON');
    if (config.path !== ':memory:' && !config.readOnly) {
      db.exec('PRAGMA journal_mode=WAL');
      db.exec('PRAGMA synchronous=FULL');
    }
    const repositories = createRepositories(db);
    let accounts: ReturnType<typeof accountRepository> | undefined;
    let closed = false;
    return Object.freeze({
      archivePreviousEpoch: (input: { serverEpoch: string; now: number }) =>
        archivePreviousEpoch(db, input),
      commitBoundary: (batch: import('./domain-rows.js').BoundaryCommit) =>
        commitBoundary(db, batch),
      repositories,
      get accounts() {
        return (accounts ??= accountRepository(db));
      },
      rooms: roomRepository(db),
      hands: {
        commitHandAction: (b: HandActionCommit) => commitHandAction(db, b),
        commitHandStart: (b: HandStartCommit) => commitHandStart(db, b),
        readHand: (id: string) => readHand(db, id),
      },
      migrate() {
        migrate(db);
      },
      close() {
        if (!closed) {
          db.close();
          closed = true;
        }
      },
    });
  } catch (error) {
    native?.close();
    throw databaseError(error);
  }
}
