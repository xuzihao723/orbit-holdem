import type { DatabaseSync } from 'node:sqlite';
import { sessionRepository } from './session-repository.js';
import { commandRepository } from './command-repository.js';
import { historyRepository } from './history-repository.js';
import { ledgerRepository } from './ledger-repository.js';
import { findInternalReceipt } from './internal-receipt.js';
import type { PersistenceRepositories } from './rows.js';
export type * from './rows.js';
export function createRepositories(db: DatabaseSync): PersistenceRepositories {
  return Object.freeze({
    findInternalReceipt: (scope: string, id: string) => findInternalReceipt(db, scope, id),
    ...sessionRepository(db),
    ...commandRepository(db),
    ...historyRepository(db),
    ...ledgerRepository(db),
  });
}
