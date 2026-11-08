import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { gameContext } from '../helpers/game-context.js';
import { createApplicationRuntime } from '../../apps/server/src/application-runtime.js';
import { createPokerServer } from '../../apps/server/src/create-server.js';
import { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import { memoryCredentialStore } from '../../apps/web/src/network/credential-store.js';
import { persistenceContext, storedSession } from '../helpers/persistence-context.js';

test('restoring a snapshot keeps the account but invalidates restored login and verification state', () => {
  const data = persistenceContext();
  try {
    data.db.repositories.insertSession(storedSession('account-1'));
    data.raw
      .prepare('INSERT INTO accounts(session_id,email,password_hash,created_at) VALUES (?,?,?,?)')
      .run('account-1', 'test@example.com', 'test-hash', 1);
    data.raw
      .prepare('INSERT INTO account_logins VALUES (?,?,?)')
      .run('cookie-digest', 'account-1', 10000);
    data.raw
      .prepare('INSERT INTO email_challenges VALUES (?,?,?,?,?,?,?,?,?)')
      .run('id', 'test@example.com', 'reset', 'flow', 'mac', 1, 10000, 0, 'proof');
    data.raw
      .prepare('INSERT INTO google_auth_flows VALUES (?,?,?,?,?,?)')
      .run('state', 'browser', 'verifier', 'nonce', '/', 10000);
    const backup = join(data.directory, 'snapshot.sqlite');
    const target = join(data.directory, 'restored.sqlite');
    const run = (args: string[]) =>
      spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    const copied = run(['scripts/backup-db.mjs', '--source', data.path, '--out', backup]);
    expect(copied.status, copied.stderr).toBe(0);
    const result = run([
      'scripts/restore-db.mjs',
      '--source',
      backup,
      '--target',
      target,
      '--apply',
      '--stopped',
    ]);
    expect(result.status, result.stderr).toBe(0);
    const restored = new DatabaseSync(target, { readOnly: true });
    try {
      expect(restored.prepare('SELECT COUNT(*) n FROM accounts').get()?.n).toBe(1);
      expect(restored.prepare('SELECT COUNT(*) n FROM account_logins').get()?.n).toBe(0);
      expect(restored.prepare('SELECT COUNT(*) n FROM email_challenges').get()?.n).toBe(0);
      expect(restored.prepare('SELECT COUNT(*) n FROM google_auth_flows').get()?.n).toBe(0);
      expect(data.raw.prepare('SELECT COUNT(*) n FROM account_logins').get()?.n).toBe(1);
    } finally {
      restored.close();
    }
  } finally {
    data.close();
  }
});
test('native online backup includes committed WAL and an offline restore never overwrites an existing database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-backup-test-')),
    source = join(dir, 'source.sqlite'),
    backup = join(dir, 'backup.sqlite'),
    target = join(dir, 'restored.sqlite');
  const db = new DatabaseSync(source);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE hands (hand_id TEXT PRIMARY KEY); INSERT INTO hands VALUES ('committed')",
  );
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/backup-db.mjs', '--source', source, '--out', backup],
      { encoding: 'utf8', windowsHide: true, timeout: 15000 },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).counts.hands).toBe(1);
    const check = spawnSync(
      process.execPath,
      ['scripts/restore-db.mjs', '--source', backup, '--target', target],
      { encoding: 'utf8', windowsHide: true },
    );
    expect(check.status, check.stderr).toBe(0);
    expect(existsSync(target)).toBe(false);
    const restored = spawnSync(
      process.execPath,
      ['scripts/restore-db.mjs', '--source', backup, '--target', target, '--apply', '--stopped'],
      { encoding: 'utf8', windowsHide: true },
    );
    expect(restored.status, restored.stderr).toBe(0);
    const read = new DatabaseSync(target, { readOnly: true });
    try {
      expect(read.prepare('SELECT hand_id FROM hands').get()!.hand_id).toBe('committed');
    } finally {
      read.close();
    }
    expect(
      spawnSync(process.execPath, ['scripts/backup-db.mjs', '--source', source, '--out', backup], {
        encoding: 'utf8',
      }).status,
    ).toBe(1);
    expect(
      spawnSync(
        process.execPath,
        ['scripts/restore-db.mjs', '--source', backup, '--target', target, '--apply', '--stopped'],
        { encoding: 'utf8' },
      ).status,
    ).toBe(1);
  } finally {
    db.close();
    expect(dirname(resolve(dir))).toBe(resolve(tmpdir()));
    rmSync(dir, { recursive: true });
  }
});
test('restores a real SQLite room and exposes settled and interrupted history after restart', async () => {
  const original = await gameContext();
  let restored: ReturnType<typeof createApplicationRuntime> | undefined;
  let server: ReturnType<typeof createPokerServer> | undefined;
  let client: ReturnType<typeof createSocketClient> | undefined;
  try {
    expect((await original.play({ type: 'fold' })).ok).toBe(true);
    const firstHand = original.hand().handId;
    const saved = original.app.database.hands.readHand(firstHand)!.result;
    for (const human of original.humans) {
      expect(
        (
          await original.command(human.socket, 'room:ready', {
            commandId: randomUUID(),
            roomId: original.roomId,
            ready: true,
            expectedRoomVersion: original.readRoom(original.roomId).row.roomVersion,
          })
        ).ok,
      ).toBe(true);
    }
    const owner = original.humans[0]!;
    expect(
      (
        await original.command(owner.socket, 'room:start', {
          commandId: randomUUID(),
          roomId: original.roomId,
          expectedRoomVersion: original.readRoom(original.roomId).row.roomVersion,
        })
      ).ok,
    ).toBe(true);
    const secondHand = original.hand().handId;
    const backup = join(original.storage.directory, 'snapshot.sqlite');
    const target = join(original.storage.directory, 'restored.sqlite');
    const run = (args: string[]) =>
      spawnSync(process.execPath, args, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
      });
    const copied = run([
      'scripts/backup-db.mjs',
      '--source',
      original.storage.path,
      '--out',
      backup,
    ]);
    expect(copied.status, copied.stderr).toBe(0);
    expect(JSON.parse(copied.stdout).counts.hands).toBe(2);
    const applied = run([
      'scripts/restore-db.mjs',
      '--source',
      backup,
      '--target',
      target,
      '--apply',
      '--stopped',
    ]);
    expect(applied.status, applied.stderr).toBe(0);
    restored = createApplicationRuntime({
      databasePath: target,
      serverEpoch: 'restore-probe',
      now: () => 2000,
    });
    server = createPokerServer({ port: 0, application: restored });
    const { origin } = await server.listen();
    expect((await fetch(origin + '/health/ready')).status).toBe(200);
    const credentials = memoryCredentialStore();
    credentials.write({
      sessionId: owner.sessionId,
      resumeToken: owner.resumeToken,
      expiresAt: owner.expiresAt,
    });
    client = createSocketClient({ url: origin, credentials });
    await client.connect();
    expect((await client.resume()).ok).toBe(true);
    const history = await client.historyList({ cursor: null });
    if (!history.ok) throw Error(history.code);
    expect(history.items).toHaveLength(2);
    expect(history.items.find((i) => i.handId === secondHand)).toMatchObject({
      status: 'interrupted',
      netHandChange: null,
      endingStack: null,
      wonAnyPot: null,
    });
    expect(await client.replayGet(firstHand)).toMatchObject({ ok: true, result: saved });
    expect(await client.replayGet(secondHand)).toMatchObject({ ok: true, result: null });
    expect(original.app.database.hands.readHand(secondHand)!.status).toBe('active');
  } finally {
    client?.close();
    await server?.close();
    await restored?.close();
    await original.close();
  }
}, 20000);
