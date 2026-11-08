import {
  copyFileSync,
  constants,
  readFileSync,
  existsSync,
  mkdirSync,
  linkSync,
  unlinkSync,
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkBackup } from './lib/backup-check.mjs';
export function restoreDatabase(sourcePath, targetPath, { apply = false, stopped = false } = {}) {
  const source = resolve(sourcePath),
    target = resolve(targetPath),
    manifest = JSON.parse(readFileSync(source + '.json', 'utf8')),
    checked = checkBackup(source);
  if (
    manifest.schemaVersion !== 1 ||
    checked.sha256 !== manifest.sha256 ||
    checked.bytes !== manifest.bytes ||
    JSON.stringify(checked.counts) !== JSON.stringify(manifest.counts)
  )
    throw Error('BACKUP_MANIFEST_MISMATCH');
  if (
    source === target ||
    existsSync(target) ||
    existsSync(target + '-wal') ||
    existsSync(target + '-shm')
  )
    throw Error('RESTORE_TARGET_MUST_BE_NEW');
  if (!apply) return { checkOnly: true, ...checked };
  if (!stopped) throw Error('RESTORE_REQUIRES_EXPLICIT_STOPPED_FLAG');
  mkdirSync(dirname(target), { recursive: true });
  const staged = target + '.restore-' + randomUUID();
  try {
    copyFileSync(source, staged, constants.COPYFILE_EXCL);
    if (checkBackup(staged).sha256 !== checked.sha256) throw Error('RESTORE_HASH_MISMATCH');
    if (Object.hasOwn(checked.counts, 'accounts')) {
      const db = new DatabaseSync(staged, { allowExtension: false });
      try {
        const transientTables = ['account_logins', 'email_challenges'];
        if (Object.hasOwn(checked.counts, 'google_auth_flows'))
          transientTables.push('google_auth_flows');
        if (
          db
            .prepare(
              'SELECT EXISTS(' +
                transientTables.map((table) => 'SELECT 1 FROM ' + table).join(' UNION ALL ') +
                ') AS pending',
            )
            .get().pending
        ) {
          db.exec(
            'PRAGMA journal_mode=DELETE; BEGIN IMMEDIATE; ' +
              transientTables.map((table) => 'DELETE FROM ' + table + '; ').join('') +
              'COMMIT',
          );
        }
      } finally {
        db.close();
      }
    }
    const restored = checkBackup(staged);
    linkSync(staged, target);
    return { restored: true, ...restored };
  } finally {
    if (existsSync(staged)) unlinkSync(staged);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2),
      source = args[args.indexOf('--source') + 1],
      target = args[args.indexOf('--target') + 1];
    if (!args.includes('--source') || !args.includes('--target') || !source || !target)
      throw Error('Usage: db:restore -- --source BACKUP --target NEW_PATH [--apply --stopped]');
    console.log(
      JSON.stringify(
        restoreDatabase(source, target, {
          apply: args.includes('--apply'),
          stopped: args.includes('--stopped'),
        }),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
