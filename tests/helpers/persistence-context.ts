import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { openDatabase } from '../../apps/server/src/persistence/db.js';
import type { AppliedBatch, StoredSession } from '../../apps/server/src/persistence/rows.js';
import { resolvePositions } from '../../packages/poker-core/src/positions.js';
export const COMMAND_A = '00000000-0000-4000-8000-000000000001',
  COMMAND_B = '00000000-0000-4000-8000-000000000002';
export function storedSession(sessionId = 's1', tokenHash = 'a'.repeat(64)): StoredSession {
  return {
    sessionId,
    tokenHash,
    nickname: 'A',
    createdAt: 1,
    expiresAt: 100000,
    connectionGeneration: 1,
  };
}
export function persistenceContext() {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-db-')),
    path = join(directory, 'test.sqlite');
  let db = openDatabase({ path, busyTimeoutMs: 10 });
  db.migrate();
  const raw = new DatabaseSync(path);
  let closed = false;
  return {
    directory,
    path,
    raw,
    get db() {
      return db;
    },
    reopen() {
      db.close();
      db = openDatabase({ path, busyTimeoutMs: 10 });
      db.migrate();
      return db;
    },
    close() {
      if (closed) return;
      closed = true;
      raw.close();
      db.close();
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('orbit-db-'))
        throw new Error('UNSAFE_TEST_CLEANUP');
      rmSync(target, { recursive: true, force: true });
    },
  };
}
export function seedPersistenceGraph(
  context: ReturnType<typeof persistenceContext>,
  session = storedSession(),
  insertSession = true,
) {
  const { raw } = context;
  if (insertSession) context.db.repositories.insertSession(session);
  raw
    .prepare(
      'INSERT INTO rooms(room_id,room_code,capacity,status,room_version,server_epoch,host_participant_id,match_id,current_hand_id,created_at,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run('r1', 'ABC234', 2, 'playing', 1, 'boot1', null, null, null, 1, null);
  raw.prepare('INSERT INTO matches VALUES (?,?,?,?,?,?)').run('m1', 'r1', 'active', null, 1, null);
  raw
    .prepare(
      'INSERT INTO participants(participant_id,room_id,session_id,bot_id,seat_id,nickname,stack,admission,joined_at,left_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run('p1', 'r1', session.sessionId, null, 0, 'A', 2000, 'active', 1, null);
  raw
    .prepare(
      'INSERT INTO participants(participant_id,room_id,session_id,bot_id,seat_id,nickname,stack,admission,joined_at,left_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run('p2', 'r1', null, 'b1', 1, 'B', 2000, 'active', 1, null);
  raw.prepare('INSERT INTO hands VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    'h1',
    'r1',
    'm1',
    'boot1',
    1,
    'active',
    '["p1","p2"]',
    JSON.stringify([
      { participantId: 'p1', stack: 2000 },
      { participantId: 'p2', stack: 2000 },
    ]),
    JSON.stringify(resolvePositions([0, 1], 0)),
    4000,
    null,
    1,
    null,
  );
}
export function appliedBatch(
  sequence = 1,
  commandId = COMMAND_A,
  expected = sequence,
): AppliedBatch {
  const next = expected + 1;
  return {
    events: [
      {
        handId: 'h1',
        sequence,
        handVersion: next,
        kind: 'actionApplied',
        payload: { seatId: 0, actionType: 'call', paidAmount: 10, raiseTo: null },
        visibility: 'public',
        ownerParticipantId: null,
        occurredAt: 10,
      },
    ],
    receipt: {
      actorScope: 'session:s1',
      commandId,
      payloadHash: 'b'.repeat(64),
      event: 'game:action',
      result: {
        protocolVersion: 1,
        serverEpoch: 'boot1',
        serverTime: 10,
        commandId,
        ok: true,
        duplicate: false,
        roomId: 'r1',
        appliedRoomVersion: 1,
        handId: 'h1',
        appliedHandVersion: next,
      },
      roomId: 'r1',
      appliedRoomVersion: 1,
      handId: 'h1',
      appliedHandVersion: next,
      createdAt: 10,
    },
    handVersionUpdate: { handId: 'h1', expected, next },
  };
}
