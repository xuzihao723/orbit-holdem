import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../../apps/server/src/persistence/db.js';
import { withSqlTransaction } from '../../apps/server/src/persistence/transaction.js';
import {
  persistenceContext,
  seedPersistenceGraph,
  storedSession,
  appliedBatch,
  COMMAND_A,
  COMMAND_B,
} from '../helpers/persistence-context.js';
const contexts: ReturnType<typeof persistenceContext>[] = [];
function context() {
  const c = persistenceContext();
  contexts.push(c);
  return c;
}
afterEach(() => {
  for (const c of contexts.splice(0)) c.close();
});
it('migrates the room and account tables once and preserves inserted data on repeated migration', () => {
  const c = context();
  seedPersistenceGraph(c);
  c.db.migrate();
  expect(
    c.raw
      .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name),
  ).toEqual([
    'account_logins',
    'accounts',
    'auth_rate',
    'chip_ledger',
    'command_receipts',
    'email_challenges',
    'google_auth_flows',
    'hand_events',
    'hands',
    'matches',
    'participants',
    'rooms',
    'sessions',
  ]);
  expect(c.raw.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
  expect(c.db.repositories.findSessionById('s1')).toEqual(storedSession());
  expect(c.raw.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
  expect(c.raw.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
});
it('rejects unknown future schema versions instead of silently recreating the database', () => {
  const c = context();
  seedPersistenceGraph(c);
  c.raw.exec('PRAGMA user_version=99');
  expect(() => c.db.migrate()).toThrow('PERSISTENCE_SCHEMA_MISMATCH');
  expect(c.db.repositories.findSessionById('s1')).toEqual(storedSession());
});
it('commits events, receipt and version together and reads them after closing and reopening the file', () => {
  const c = context();
  seedPersistenceGraph(c);
  const batch = appliedBatch();
  c.db.repositories.commitAppliedCommand(batch);
  expect(c.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(1);
  expect(
    c.raw.prepare('SELECT hand_version FROM hands WHERE hand_id=?').get('h1')?.hand_version,
  ).toBe(2);
  expect(c.db.repositories.findReceipt('session:s1', COMMAND_A)).toEqual(batch.receipt);
  c.reopen();
  expect(c.db.repositories.findReceipt('session:s1', COMMAND_A)).toEqual(batch.receipt);
  expect(c.db.repositories.findSessionById('s1')).toEqual(storedSession());
});
it('rolls back an inserted new event when a later receipt collides and leaves the old receipt unchanged', () => {
  const c = context();
  seedPersistenceGraph(c);
  const first = appliedBatch();
  c.db.repositories.commitAppliedCommand(first);
  expect(() => c.db.repositories.commitAppliedCommand(appliedBatch(2, COMMAND_A, 2))).toThrow(
    'PERSISTENCE_CONFLICT',
  );
  expect(
    c.raw
      .prepare('SELECT sequence FROM hand_events')
      .all()
      .map((r) => r.sequence),
  ).toEqual([1]);
  expect(c.raw.prepare('SELECT hand_version FROM hands').get()?.hand_version).toBe(2);
  expect(c.db.repositories.findReceipt('session:s1', COMMAND_A)).toEqual(first.receipt);
  expect(c.raw.isTransaction).toBe(false);
  // A second connection cannot see uncommitted leftovers. A new transaction on
  // the actual writer proves that rollback released its transaction as well.
  expect(() => c.db.repositories.commitAppliedCommand(appliedBatch(2, COMMAND_B, 2))).not.toThrow();
  expect(c.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(2);
});
it('rolls back duplicate events and stale versions and scopes receipts by actor', () => {
  const c = context();
  seedPersistenceGraph(c);
  c.db.repositories.commitAppliedCommand(appliedBatch());
  expect(() => c.db.repositories.commitAppliedCommand(appliedBatch(1, COMMAND_B, 2))).toThrow();
  expect(() => c.db.repositories.commitAppliedCommand(appliedBatch(2, COMMAND_B, 1))).toThrow(
    'PERSISTENCE_STALE_VERSION',
  );
  expect(c.db.repositories.findReceipt('session:s1', COMMAND_B)).toBeNull();
  const next = appliedBatch(2, COMMAND_A, 2);
  c.db.repositories.commitAppliedCommand({
    ...next,
    receipt: { ...next.receipt, actorScope: 'bot:b1' },
  });
  expect(c.db.repositories.findReceipt('session:s1', COMMAND_A)?.appliedHandVersion).toBe(2);
  expect(c.db.repositories.findReceipt('bot:b1', COMMAND_A)?.appliedHandVersion).toBe(3);
});
it('rejects private owner mismatch and unexpected event or receipt fields before storing a partial batch', () => {
  const c = context();
  seedPersistenceGraph(c);
  const b = appliedBatch();
  for (const events of [
    [
      {
        ...b.events[0]!,
        kind: 'holeDealt',
        visibility: 'owner' as const,
        ownerParticipantId: 'p2',
        payload: { seatId: 0, cards: ['AS', 'AH'] },
      },
    ],
    [
      {
        ...b.events[0]!,
        payload: {
          seatId: 0,
          actionType: 'call',
          paidAmount: 10,
          raiseTo: null,
          tokenHash: 'secret',
        },
      },
    ],
  ])
    expect(() => c.db.repositories.commitAppliedCommand({ ...b, events })).toThrow(
      'PERSISTENCE_INVALID_INPUT',
    );
  expect(() =>
    c.db.repositories.commitAppliedCommand({
      ...b,
      receipt: {
        ...b.receipt,
        result: { ...Object(b.receipt.result), resumeToken: 'must-not-store' },
      },
    }),
  ).toThrow('PERSISTENCE_INVALID_INPUT');
  expect(c.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(0);
  expect(c.db.repositories.findReceipt('session:s1', COMMAND_A)).toBeNull();
});
it('enforces storage unique, foreign-key, seat and visibility constraints even through native SQL', () => {
  const c = context();
  seedPersistenceGraph(c);
  expect(() => c.db.repositories.insertSession(storedSession('s2'))).toThrow(
    'PERSISTENCE_CONFLICT',
  );
  expect(() =>
    c.raw
      .prepare(
        'INSERT INTO rooms(room_id,room_code,capacity,status,room_version,server_epoch,host_participant_id,match_id,current_hand_id,created_at,closed_at) SELECT ?,room_code,capacity,status,room_version,server_epoch,NULL,NULL,NULL,created_at,NULL FROM rooms WHERE room_id=?',
      )
      .run('r2', 'r1'),
  ).toThrow();
  for (const values of [
    ['p3', 'r1', null, 'b2', 0],
    ['p3', 'r1', 's1', null, 2],
    ['p3', 'r1', null, 'b2', 4],
    ['p3', 'missing', null, 'b2', 2],
    ['p3', 'r1', null, null, 2],
    ['p3', 'r1', 's1', 'b2', 2],
  ])
    expect(() =>
      c.raw
        .prepare(
          'INSERT INTO participants(participant_id,room_id,session_id,bot_id,seat_id,nickname,stack,admission,joined_at,left_at) VALUES (?,?,?,?,?,?,2000,?,1,NULL)',
        )
        .run(...(values as [string, string, string | null, string | null, number]), 'X', 'active'),
    ).toThrow();
  expect(() =>
    c.raw
      .prepare('INSERT INTO hand_events VALUES (?,?,?,?,?,?,?,?)')
      .run('h1', 1, 2, 'holeDealt', '{}', 'owner', null, 1),
  ).toThrow();
  expect(() =>
    c.raw
      .prepare('INSERT INTO hand_events VALUES (?,?,?,?,?,?,?,?)')
      .run('h1', 1, 2, 'actionApplied', 'invalid json', 'public', null, 1),
  ).toThrow();
});
it('allows a closed room code and departed seat to be reused while retaining previous identities', () => {
  const c = context();
  seedPersistenceGraph(c);
  c.raw.prepare('UPDATE rooms SET status=? WHERE room_id=?').run('closed', 'r1');
  c.raw
    .prepare(
      'INSERT INTO rooms(room_id,room_code,capacity,status,room_version,server_epoch,host_participant_id,match_id,current_hand_id,created_at,closed_at) SELECT ?,room_code,capacity,?,room_version,server_epoch,NULL,NULL,NULL,created_at,NULL FROM rooms WHERE room_id=?',
    )
    .run('r2', 'waiting', 'r1');
  c.raw.prepare('UPDATE participants SET left_at=2 WHERE participant_id=?').run('p1');
  c.raw
    .prepare(
      'INSERT INTO participants(participant_id,room_id,session_id,bot_id,seat_id,nickname,stack,admission,joined_at,left_at) VALUES (?,?,?,?,?,?,2000,?,3,NULL)',
    )
    .run('p3', 'r1', 's1', null, 0, 'A2', 'waitingNextHand');
  expect(
    c.raw
      .prepare('SELECT participant_id FROM participants WHERE session_id=? ORDER BY joined_at')
      .all('s1')
      .map((r) => r.participant_id),
  ).toEqual(['p1', 'p3']);
});
it('rolls back commit-time deferred foreign keys and rejects nested or asynchronous transactions', () => {
  const c = context();
  seedPersistenceGraph(c);
  expect(() =>
    withSqlTransaction(c.raw, () => {
      c.raw.prepare('UPDATE rooms SET host_participant_id=?').run('absent');
      c.raw
        .prepare('INSERT INTO hand_events VALUES (?,?,?,?,?,?,?,?)')
        .run('h1', 1, 2, 'actionApplied', '{}', 'public', null, 1);
    }),
  ).toThrow();
  expect(c.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(0);
  expect(
    c.raw.prepare('SELECT host_participant_id FROM rooms').get()?.host_participant_id,
  ).toBeNull();
  expect(() => withSqlTransaction(c.raw, () => Promise.resolve())).toThrow(
    'ASYNC_TRANSACTION_CALLBACK',
  );
  expect(() => withSqlTransaction(c.raw, () => withSqlTransaction(c.raw, () => 1))).toThrow(
    'NESTED_TRANSACTION',
  );
  expect(c.raw.isTransaction).toBe(false);
});
it('keeps generation compare-and-swap monotone and rejects expired, mismatched and unsafe inputs', () => {
  const c = context();
  c.db.repositories.insertSession(storedSession());
  expect(
    c.db.repositories.incrementSessionGeneration({ sessionId: 's1', expected: 1, now: 2 })
      .connectionGeneration,
  ).toBe(2);
  expect(() =>
    c.db.repositories.incrementSessionGeneration({ sessionId: 's1', expected: 1, now: 2 }),
  ).toThrow('PERSISTENCE_CONFLICT');
  expect(() =>
    c.db.repositories.incrementSessionGeneration({ sessionId: 's1', expected: 2, now: 100000 }),
  ).toThrow('PERSISTENCE_SESSION_EXPIRED');
  expect(() =>
    c.db.repositories.insertSession({ ...storedSession('s2', 'c'.repeat(64)), createdAt: NaN }),
  ).toThrow('PERSISTENCE_INVALID_INPUT');
  expect(() =>
    c.db.repositories.insertSession({
      ...storedSession('s2', 'c'.repeat(64)),
      connectionGeneration: Number.MAX_SAFE_INTEGER + 1,
    }),
  ).toThrow('PERSISTENCE_INVALID_INPUT');
});
it('queries history ownership through the frozen hand roster, not mere room membership', () => {
  const c = context();
  seedPersistenceGraph(c);
  c.raw
    .prepare('UPDATE hands SET status=?,result_json=?,ended_at=2 WHERE hand_id=?')
    .run('settled', '{}', 'h1');
  expect(c.db.repositories.listOwnedHandIds('s1')).toEqual(['h1']);
  expect(c.db.repositories.findOwnedHand('s1', 'h1')?.status).toBe('settled');
  c.db.repositories.insertSession(storedSession('s2', 'c'.repeat(64)));
  c.raw
    .prepare(
      'INSERT INTO participants(participant_id,room_id,session_id,bot_id,seat_id,nickname,stack,admission,joined_at,left_at) VALUES (?,?,?,?,?,?,0,?,1,NULL)',
    )
    .run('p3', 'r1', 's2', null, 2, 'waiting', 'waitingNextHand');
  expect(c.db.repositories.listOwnedHandIds('s2')).toEqual([]);
  expect(c.db.repositories.findOwnedHand('s2', 'h1')).toBeNull();
  c.reopen();
  expect(c.db.repositories.listOwnedHandIds('s1')).toEqual(['h1']);
});
it('reports a real writer lock and read-only failure without partial data or raw SQL secrets', () => {
  const c = context();
  c.db.repositories.insertSession(storedSession());
  c.raw.exec('BEGIN IMMEDIATE');
  try {
    expect(() => c.db.repositories.insertSession(storedSession('s2', 'c'.repeat(64)))).toThrow(
      'PERSISTENCE_UNAVAILABLE',
    );
  } finally {
    c.raw.exec('ROLLBACK');
  }
  expect(c.db.repositories.findSessionById('s2')).toBeNull();
  const readonly = openDatabase({ path: c.path, busyTimeoutMs: 10, readOnly: true });
  try {
    readonly.migrate();
    expect(readonly.repositories.findSessionById('s1')).toEqual(storedSession());
    expect(() => readonly.repositories.insertSession(storedSession('s2', 'c'.repeat(64)))).toThrow(
      'PERSISTENCE_UNAVAILABLE',
    );
  } finally {
    readonly.close();
  }
});
it('persists signed ledger entries with validated attribution and room ownership', () => {
  const c = context();
  seedPersistenceGraph(c);
  c.db.repositories.commitAppliedCommand(appliedBatch());
  const entry = {
    entryId: 'l1',
    roomId: 'r1',
    matchId: 'm1',
    participantId: 'p1',
    type: 'seat_cashout' as const,
    delta: -100,
    reason: 'left',
    occurredAt: 11,
    sourceActorScope: 'session:s1',
    sourceCommandId: COMMAND_A,
    sourceSystemEventId: null,
  };
  c.db.repositories.appendLedger(entry);
  expect(c.db.repositories.listLedger('r1')).toEqual([entry]);
  expect(() => c.db.repositories.appendLedger({ ...entry, entryId: 'l2', delta: 0.5 })).toThrow(
    'PERSISTENCE_INVALID_INPUT',
  );
  expect(() =>
    c.db.repositories.appendLedger({ ...entry, entryId: 'l2', roomId: 'absent' }),
  ).toThrow('PERSISTENCE_INVALID_INPUT');
  expect(() =>
    c.db.repositories.appendLedger({ ...entry, entryId: 'l2', sourceSystemEventId: 'timeout' }),
  ).toThrow('PERSISTENCE_INVALID_INPUT');
  c.reopen();
  expect(c.db.repositories.listLedger('r1')).toEqual([entry]);
});
it('rejects nested seats outside the frozen hand rather than trusting their logical seat range', () => {
  const c = context();
  seedPersistenceGraph(c);
  const b = appliedBatch();
  for (const event of [
    { ...b.events[0]!, kind: 'handStarted', payload: { dealerSeatId: 0, seats: [0, 3] } },
    {
      ...b.events[0]!,
      kind: 'showdownRevealed',
      payload: { cards: [{ seatId: 3, cards: ['AS', 'AH'] }] },
    },
  ])
    expect(() => c.db.repositories.commitAppliedCommand({ ...b, events: [event] })).toThrow(
      'PERSISTENCE_INVALID_INPUT',
    );
  expect(c.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(0);
});
it('stores allowlisted failed command receipts without inventing applied versions', () => {
  const c = context();
  seedPersistenceGraph(c);
  const r = appliedBatch().receipt,
    receipt = {
      ...r,
      appliedRoomVersion: null,
      handId: null,
      appliedHandVersion: null,
      result: {
        protocolVersion: 1,
        serverEpoch: 'boot1',
        serverTime: 10,
        commandId: COMMAND_A,
        ok: false,
        duplicate: false,
        code: 'ILLEGAL_AMOUNT',
        retryable: false,
        retryAfterMs: null,
        fieldIssues: [{ field: 'action.raiseTo', reason: 'outOfRange' }],
        roomId: 'r1',
        handId: 'h1',
        latestRoomVersion: 1,
        latestHandVersion: 1,
      },
    };
  c.db.repositories.commitAppliedCommand({ events: [], receipt, handVersionUpdate: null });
  expect(c.db.repositories.findReceipt('session:s1', COMMAND_A)).toEqual(receipt);
  expect(c.raw.prepare('SELECT hand_version FROM hands').get()?.hand_version).toBe(1);
  expect(() =>
    c.db.repositories.commitAppliedCommand({
      events: [],
      receipt: {
        ...receipt,
        commandId: COMMAND_B,
        result: { ...receipt.result, commandId: COMMAND_B, retryable: true },
      },
      handVersionUpdate: null,
    }),
  ).toThrow('PERSISTENCE_INVALID_INPUT');
});
it('rejects malformed frozen rosters and recognizes schema drift at the same migration version', () => {
  const c = context();
  seedPersistenceGraph(c);
  c.raw
    .prepare('UPDATE hands SET participant_ids_json=? WHERE hand_id=?')
    .run('{"notAnArray":"p1"}', 'h1');
  expect(() => c.db.repositories.findOwnedHand('s1', 'h1')).toThrow('PERSISTENCE_INVALID_INPUT');
  c.raw.exec('DROP INDEX rooms_active_code');
  expect(() => c.db.migrate()).toThrow('PERSISTENCE_SCHEMA_MISMATCH');
});
it('rejects nested serialization hooks in both events and failed receipts without invoking them', () => {
  const c = context();
  seedPersistenceGraph(c);
  const b = appliedBatch();
  let invoked = 0;
  const seats = Object.assign([0, 1], {
    toJSON() {
      invoked++;
      return { resumeToken: 'secret', deck: ['AS'] };
    },
  });
  expect(() =>
    c.db.repositories.commitAppliedCommand({
      ...b,
      events: [{ ...b.events[0]!, kind: 'handStarted', payload: { dealerSeatId: 0, seats } }],
    }),
  ).toThrow('PERSISTENCE_INVALID_INPUT');
  const issues = Object.assign([], {
    toJSON() {
      invoked++;
      return [{ field: 'secret', reason: 'invalidType', resumeToken: 'secret' }];
    },
  });
  const receipt = {
    ...b.receipt,
    appliedRoomVersion: null,
    handId: null,
    appliedHandVersion: null,
    result: {
      protocolVersion: 1,
      serverEpoch: 'boot1',
      serverTime: 10,
      commandId: COMMAND_A,
      ok: false,
      duplicate: false,
      code: 'ILLEGAL_AMOUNT',
      retryable: false,
      retryAfterMs: null,
      fieldIssues: issues,
      roomId: 'r1',
      handId: 'h1',
      latestRoomVersion: 1,
      latestHandVersion: 1,
    },
  };
  expect(() =>
    c.db.repositories.commitAppliedCommand({ events: [], receipt, handVersionUpdate: null }),
  ).toThrow('PERSISTENCE_INVALID_INPUT');
  expect(invoked).toBe(0);
  expect(c.raw.prepare('SELECT COUNT(*) n FROM hand_events').get()?.n).toBe(0);
  expect(c.db.repositories.findReceipt('session:s1', COMMAND_A)).toBeNull();
});
it('rolls back an actual write when a callback returns a callable thenable', () => {
  const c = context();
  seedPersistenceGraph(c);
  const callable = Object.assign(() => undefined, { then: () => undefined });
  expect(() =>
    withSqlTransaction(c.raw, () => {
      c.raw.prepare('UPDATE sessions SET nickname=? WHERE session_id=?').run('wrong', 's1');
      return callable;
    }),
  ).toThrow('ASYNC_TRANSACTION_CALLBACK');
  expect(c.db.repositories.findSessionById('s1')?.nickname).toBe('A');
  expect(c.raw.isTransaction).toBe(false);
});
