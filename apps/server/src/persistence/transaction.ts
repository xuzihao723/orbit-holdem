import type { DatabaseSync } from 'node:sqlite';
import { PersistenceError, databaseError } from './errors.js';
export function withSqlTransaction<T>(db: DatabaseSync, work: () => T): T {
  if (db.isTransaction) throw new PersistenceError('NESTED_TRANSACTION');
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch (error) {
    throw databaseError(error);
  }
  try {
    const result = work();
    if (
      result &&
      (typeof result === 'object' || typeof result === 'function') &&
      'then' in result &&
      typeof result.then === 'function'
    )
      throw new PersistenceError('ASYNC_TRANSACTION_CALLBACK');
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      if (db.isTransaction) db.exec('ROLLBACK');
    } catch {
      throw new PersistenceError('PERSISTENCE_UNAVAILABLE');
    }
    throw databaseError(error);
  }
}
