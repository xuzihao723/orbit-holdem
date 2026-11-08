import { DatabaseSync, backup } from 'node:sqlite';
import { checkBackup } from './lib/backup-check.mjs';
const source = new DatabaseSync(process.argv[2], { readOnly: true, allowExtension: false });
try {
  await backup(source, process.argv[3]);
} finally {
  source.close();
}
console.log(JSON.stringify(checkBackup(process.argv[3])));
