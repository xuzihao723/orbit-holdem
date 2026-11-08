import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  debitCount,
  matchesRecovery,
  readSamples,
  summarizeSamples,
  writeSamples,
  type RecoveryState,
  type Sample,
} from '../../scripts/lib/reconnect-experiment.js';

const authoritative: RecoveryState = {
  sessionId: 'session',
  participantId: 'participant',
  serverEpoch: 'epoch',
  roomId: 'room',
  roomVersion: 8,
  handId: 'hand',
  handVersion: 7,
  actorSeatId: 1,
  turnId: 'turn',
  stack: 1960,
};

function sample(arm: Sample['arm'], recoveryMs: number | null): Sample {
  return {
    condition: 'offline5',
    pairIndex: 1,
    arm,
    seed: 23,
    buildId: 'candidate',
    runStartUtc: '2026-11-06T00:00:00.000Z',
    outageStartedMs: 100,
    networkRestoredMs: 5100,
    actualOutageMs: 5000,
    measuredRttMs: 3.4,
    preHandVersion: 6,
    serverHandVersion: 7,
    clientHandVersion: recoveryMs === null ? 6 : 7,
    recovered: recoveryMs !== null,
    recoveryMs,
    extraDebitCount: recoveryMs === null ? null : 0,
    duplicateProbeStatus: recoveryMs === null ? 'not_sent' : 'duplicate',
    couldContinue: recoveryMs !== null,
    failureReason: recoveryMs === null ? 'view_mismatch' : '',
  };
}

describe('reconnect experiment evidence', () => {
  it('requires matching identity, version, actor and stack', () => {
    expect(matchesRecovery(null, authoritative)).toBe(false);
    expect(matchesRecovery({ ...authoritative, handVersion: 6 }, authoritative)).toBe(false);
    expect(matchesRecovery({ ...authoritative, stack: 1920 }, authoritative)).toBe(false);
    expect(matchesRecovery({ ...authoritative, actorSeatId: 0 }, authoritative)).toBe(false);
    expect(matchesRecovery({ ...authoritative, sessionId: 'other' }, authoritative)).toBe(false);
    expect(matchesRecovery(authoritative, authoritative)).toBe(true);
  });

  it('counts an additional debit only when the retry decreases the stack', () => {
    expect(debitCount(1960, 1960)).toBe(0);
    expect(debitCount(1960, 1940)).toBe(1);
    expect(debitCount(1960, null)).toBeNull();
  });

  it('interleaves paired runs and uses the same seed in both arms', () => {
    const plan = buildSchedule(2, 23);
    expect(plan).toHaveLength(12);
    expect(plan.slice(0, 4).map((r) => r.arm)).toEqual([
      'snapshot',
      'messages',
      'messages',
      'snapshot',
    ]);
    expect(plan.slice(0, 4).map((r) => r.seed)).toEqual([24, 24, 25, 25]);
    expect(plan[4]?.seed).toBe(1024);
  });

  it('retains timeouts and an explicit retry denominator when recomputing the CSV', () => {
    const rows = [
      sample('snapshot', 300),
      sample('messages', null),
      {
        ...sample('snapshot', 500),
        pairIndex: 2,
        seed: 24,
        extraDebitCount: 1,
        couldContinue: false,
        failureReason: 'extra_debit',
      },
    ];
    const csv = writeSamples(rows);
    expect(readSamples(csv)).toEqual(rows);
    expect(summarizeSamples(readSamples(csv))).toEqual([
      {
        condition: 'offline5',
        arm: 'snapshot',
        samples: 2,
        recovered: 2,
        recoveryRate: 1,
        medianMs: 400,
        p95Ms: 500,
        duplicateProbes: 2,
        extraDebits: 1,
        unableToContinue: 1,
      },
      {
        condition: 'offline5',
        arm: 'messages',
        samples: 1,
        recovered: 0,
        recoveryRate: 0,
        medianMs: null,
        p95Ms: null,
        duplicateProbes: 0,
        extraDebits: 0,
        unableToContinue: 1,
      },
    ]);
    expect(() => readSamples(writeSamples([rows[0]!, rows[0]!]))).toThrow(/DUPLICATE_SAMPLE/);
    expect(() => readSamples(csv.replace(',false,,', ',false,0,'))).toThrow(/INVALID_SAMPLE/);
  });
});
