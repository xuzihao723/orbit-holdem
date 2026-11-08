import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { withSqlTransaction } from './transaction.js';
import { PersistenceError, databaseError } from './errors.js';
import { integer } from './rows.js';
const fingerprint = (db: DatabaseSync) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        db
          .prepare(
            'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
          )
          .all(),
      ),
    )
    .digest('hex');
export function migrate(db: DatabaseSync): void {
  try {
    const version = integer(db.prepare('PRAGMA user_version').get()?.user_version);
    const sources = [
      '001-initial.sql',
      '002-room-controls.sql',
      '003-accounts.sql',
      '004-google-auth.sql',
    ].map((name) => readFileSync(new URL('./migrations/' + name, import.meta.url), 'utf8'));
    if (version > sources.length) throw new PersistenceError('PERSISTENCE_SCHEMA_MISMATCH');
    const check = (v: number) => {
      const reference = new DatabaseSync(':memory:');
      try {
        for (const source of sources.slice(0, v)) reference.exec(source);
        if (fingerprint(reference) !== fingerprint(db))
          throw new PersistenceError('PERSISTENCE_SCHEMA_MISMATCH');
      } finally {
        reference.close();
      }
    };
    check(version);
    if (version < sources.length)
      withSqlTransaction(db, () => {
        for (const source of sources.slice(version)) db.exec(source);
        db.exec('PRAGMA user_version=' + sources.length);
        check(sources.length);
      });
  } catch (error) {
    throw databaseError(error);
  }
}
