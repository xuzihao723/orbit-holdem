import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { openDatabase } from '../../apps/server/src/persistence/db.js';
it.each([1, 2, 3])('upgrades a real v%i file preserving identity and bot data', (version) => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-upgrade-')),
    path = join(dir, 'v1.sqlite');
  let native: DatabaseSync | undefined, db: ReturnType<typeof openDatabase> | undefined;
  try {
    native = new DatabaseSync(path);
    native.exec(readFileSync('apps/server/src/persistence/migrations/001-initial.sql', 'utf8'));
    native
      .prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?)')
      .run('s', 'a'.repeat(64), 'A', 1, 10000, 1);
    native
      .prepare(
        'INSERT INTO rooms(room_id,room_code,capacity,status,room_version,server_epoch,host_participant_id,match_id,current_hand_id,created_at,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run('r', 'ABC234', 2, 'waiting', 1, 'old', null, null, null, 1, null);
    native
      .prepare(
        'INSERT INTO participants(participant_id,room_id,session_id,bot_id,seat_id,nickname,stack,admission,joined_at,left_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .run('p', 'r', null, 'bot', 1, 'Bot', 2000, 'active', 1, null);
    if (version >= 2)
      native.exec(
        readFileSync('apps/server/src/persistence/migrations/002-room-controls.sql', 'utf8'),
      );
    if (version === 3) {
      native.exec(readFileSync('apps/server/src/persistence/migrations/003-accounts.sql', 'utf8'));
      native
        .prepare('INSERT INTO accounts VALUES (?,?,?,?)')
        .run('s', 'legacy@example.com', 'legacy-hash', 1);
      native.prepare('INSERT INTO account_logins VALUES (?,?,?)').run('login', 's', 10000);
    }
    native.exec('PRAGMA user_version=' + version);
    native.close();
    native = undefined;
    db = openDatabase({ path, busyTimeoutMs: 10 });
    db.migrate();
    db.migrate();
    db.close();
    db = undefined;
    native = new DatabaseSync(path, { readOnly: true });
    expect(native.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
    expect(
      native.prepare('SELECT COUNT(*) n FROM sqlite_schema WHERE type=?').get('table')?.n,
    ).toBe(13);
    expect(native.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    if (version === 3) {
      expect(native.prepare('SELECT * FROM accounts').get()).toMatchObject({
        session_id: 's',
        email: 'legacy@example.com',
        password_hash: 'legacy-hash',
        google_sub: null,
      });
      expect(
        native.prepare('SELECT session_id FROM account_logins WHERE token_hash=?').get('login')
          ?.session_id,
      ).toBe('s');
    }
    expect(native.prepare('SELECT ready,bot_difficulty FROM participants').get()).toMatchObject({
      ready: 0,
      bot_difficulty: 'basic',
    });
    expect(native.prepare('SELECT token_hash FROM sessions').get()?.token_hash).toBe(
      'a'.repeat(64),
    );
  } finally {
    native?.close();
    db?.close();
    expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));
    expect(basename(dir).startsWith('orbit-upgrade-')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects version-zero schema drift without committing migrations or bumping its version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-upgrade-drift-')),
    path = join(dir, 'drift.sqlite');
  let native: DatabaseSync | undefined, db: ReturnType<typeof openDatabase> | undefined;
  try {
    native = new DatabaseSync(path);
    native.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('keep')");
    native.close();
    native = undefined;
    db = openDatabase({ path, busyTimeoutMs: 10 });
    expect(() => db!.migrate()).toThrow('PERSISTENCE_SCHEMA_MISMATCH');
    db.close();
    db = undefined;
    native = new DatabaseSync(path);
    expect(native.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
    expect(
      native
        .prepare("SELECT name FROM sqlite_schema WHERE type='table'")
        .all()
        .map((x) => x.name),
    ).toEqual(['sentinel']);
    expect(native.prepare('SELECT value FROM sentinel').get()?.value).toBe('keep');
  } finally {
    native?.close();
    db?.close();
    expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));
    expect(basename(dir).startsWith('orbit-upgrade-drift-')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
