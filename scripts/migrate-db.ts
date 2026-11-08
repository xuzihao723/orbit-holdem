import { openDatabase } from '../apps/server/src/persistence/db.js';
import { persistenceConfig } from '../apps/server/src/persistence/config.js';
try {
  const db = openDatabase(persistenceConfig());
  try {
    db.migrate();
    console.log('Database schema ready.');
  } finally {
    db.close();
  }
} catch {
  console.error('DATABASE_MIGRATION_FAILED');
  process.exitCode = 1;
}
