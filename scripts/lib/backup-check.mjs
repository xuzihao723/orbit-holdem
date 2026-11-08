import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export function checkBackup(path) {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    if (
      db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw Error('BACKUP_INTEGRITY_FAILED');
    const allowed = [
      'schema_migrations',
      'sessions',
      'accounts',
      'account_logins',
      'google_auth_flows',
      'rooms',
      'participants',
      'matches',
      'hands',
      'hand_events',
      'command_receipts',
      'chip_ledger',
    ];
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    const counts = Object.fromEntries(
      allowed
        .filter((name) => tables.includes(name))
        .map((name) => [name, Number(db.prepare('SELECT COUNT(*) AS n FROM ' + name).get().n)]),
    );
    const bytes = readFileSync(path);
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      counts,
      integrity: 'ok',
      foreignKeys: 'ok',
    };
  } finally {
    db.close();
  }
}
