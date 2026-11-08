export const conditions = [
  { id: 'offline5', outageMs: 5000, profile: 'base' },
  { id: 'offline30', outageMs: 30000, profile: 'base' },
  { id: 'rtt300_offline5', outageMs: 5000, profile: 'rtt300' },
] as const;
const arms = ['snapshot', 'messages'] as const;
export const recoveryWindowMs = 10_000;

export interface Trial {
  condition: (typeof conditions)[number]['id'];
  pairIndex: number;
  arm: (typeof arms)[number];
  seed: number;
}

export interface RecoveryState {
  sessionId: string;
  participantId: string;
  serverEpoch: string;
  roomId: string;
  roomVersion: number;
  handId: string;
  handVersion: number;
  actorSeatId: number | null;
  turnId: string | null;
  stack: number;
}

export interface Sample extends Trial {
  buildId: string;
  runStartUtc: string;
  outageStartedMs: number;
  networkRestoredMs: number;
  actualOutageMs: number;
  measuredRttMs: number;
  preHandVersion: number;
  serverHandVersion: number;
  clientHandVersion: number | null;
  recovered: boolean;
  recoveryMs: number | null;
  extraDebitCount: number | null;
  duplicateProbeStatus: 'not_sent' | 'duplicate' | 'rejected' | 'applied' | 'timeout';
  couldContinue: boolean;
  failureReason: string;
}

const keys = [
  'condition',
  'pairIndex',
  'arm',
  'seed',
  'buildId',
  'runStartUtc',
  'outageStartedMs',
  'networkRestoredMs',
  'actualOutageMs',
  'measuredRttMs',
  'preHandVersion',
  'serverHandVersion',
  'clientHandVersion',
  'recovered',
  'recoveryMs',
  'extraDebitCount',
  'duplicateProbeStatus',
  'couldContinue',
  'failureReason',
] as const satisfies readonly (keyof Sample)[];
const header = keys.map((key) => key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())).join(',');

export function buildSchedule(pairs: number, seed: number): Trial[] {
  if (
    !Number.isSafeInteger(pairs) ||
    pairs < 1 ||
    pairs > 30 ||
    !Number.isSafeInteger(seed) ||
    !Number.isSafeInteger(seed + 2030)
  )
    throw Error('INVALID_EXPERIMENT_RANGE');
  return conditions.flatMap((condition, index) =>
    Array.from({ length: pairs }, (_, offset) => {
      const pairIndex = offset + 1;
      const order = pairIndex % 2 === 1 ? arms : [...arms].reverse();
      return order.map((arm) => ({
        condition: condition.id,
        pairIndex,
        arm,
        seed: seed + index * 1000 + pairIndex,
      }));
    }).flat(),
  );
}

export function matchesRecovery(received: RecoveryState | null, expected: RecoveryState): boolean {
  return (
    received !== null &&
    (Object.keys(expected) as (keyof RecoveryState)[]).every(
      (key) => received[key] === expected[key],
    )
  );
}

export function debitCount(before: number, after: number | null): number | null {
  return after === null ? null : Number(after < before);
}

export function writeSamples(rows: readonly Sample[]): string {
  const records = rows.map((row) =>
    keys
      .map((key) => {
        const value = String(row[key] ?? '');
        if (/[,"\r\n]/.test(value)) throw Error('INVALID_CSV_FIELD');
        return value;
      })
      .join(','),
  );
  return [header, ...records].join('\n') + '\n';
}

function numeric(raw: string, integer = false): number {
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw Error('INVALID_SAMPLE_NUMBER');
  const value = Number(raw);
  if (!Number.isFinite(value) || (integer && !Number.isSafeInteger(value)))
    throw Error('INVALID_SAMPLE_NUMBER');
  return value;
}

function flag(raw: string): boolean {
  if (raw !== 'true' && raw !== 'false') throw Error('INVALID_SAMPLE_FLAG');
  return raw === 'true';
}

export function readSamples(csv: string): Sample[] {
  const [columns, ...lines] = csv.trimEnd().split(/\r?\n/);
  if (columns !== header || !lines.length) throw Error('INVALID_SAMPLE_HEADER');
  const seen = new Set<string>();
  return lines.map((line) => {
    const values = line.split(',');
    if (values.length !== keys.length) throw Error('INVALID_SAMPLE_COLUMNS');
    const fields = Object.fromEntries(keys.map((key, i) => [key, values[i]!])) as Record<
      keyof Sample,
      string
    >;
    const condition = conditions.find((c) => c.id === fields.condition)?.id;
    const arm = arms.find((value) => value === fields.arm);
    const probeStatuses = ['not_sent', 'duplicate', 'rejected', 'applied', 'timeout'] as const;
    const duplicateProbeStatus = probeStatuses.find(
      (value) => value === fields.duplicateProbeStatus,
    );
    if (!condition || !arm || !duplicateProbeStatus) throw Error('INVALID_SAMPLE_CATEGORY');
    const row: Sample = {
      ...fields,
      condition,
      arm,
      duplicateProbeStatus,
      pairIndex: numeric(fields.pairIndex, true),
      seed: numeric(fields.seed, true),
      outageStartedMs: numeric(fields.outageStartedMs),
      networkRestoredMs: numeric(fields.networkRestoredMs),
      actualOutageMs: numeric(fields.actualOutageMs),
      measuredRttMs: numeric(fields.measuredRttMs),
      preHandVersion: numeric(fields.preHandVersion, true),
      serverHandVersion: numeric(fields.serverHandVersion, true),
      clientHandVersion:
        fields.clientHandVersion === '' ? null : numeric(fields.clientHandVersion, true),
      recovered: flag(fields.recovered),
      recoveryMs: fields.recoveryMs === '' ? null : numeric(fields.recoveryMs),
      extraDebitCount: fields.extraDebitCount === '' ? null : numeric(fields.extraDebitCount, true),
      couldContinue: flag(fields.couldContinue),
    };
    const key = [condition, row.pairIndex, arm].join(':');
    if (seen.has(key)) throw Error('DUPLICATE_SAMPLE');
    seen.add(key);
    if (
      row.pairIndex < 1 ||
      row.pairIndex > 30 ||
      !/^[\w.-]+$/.test(row.buildId) ||
      !Number.isFinite(Date.parse(row.runStartUtc)) ||
      Math.abs(row.networkRestoredMs - row.outageStartedMs - row.actualOutageMs) > 0.02 ||
      row.outageStartedMs < 0 ||
      row.actualOutageMs < 0 ||
      row.measuredRttMs < 0 ||
      row.serverHandVersion <= row.preHandVersion ||
      row.recovered !== (row.recoveryMs !== null) ||
      (row.recoveryMs !== null && (row.recoveryMs < 0 || row.recoveryMs > recoveryWindowMs)) ||
      (row.recovered && row.clientHandVersion !== row.serverHandVersion) ||
      (row.duplicateProbeStatus === 'not_sent') !== (row.extraDebitCount === null) ||
      (row.extraDebitCount !== null && ![0, 1].includes(row.extraDebitCount)) ||
      (row.couldContinue && (!row.recovered || row.extraDebitCount !== 0)) ||
      (!row.couldContinue && !row.failureReason)
    )
      throw Error('INVALID_SAMPLE');
    return row;
  });
}

export function summarizeSamples(rows: readonly Sample[]) {
  return conditions.flatMap(({ id: condition }) =>
    arms.flatMap((arm) => {
      const group = rows.filter((row) => row.condition === condition && row.arm === arm);
      if (!group.length) return [];
      const times = group.flatMap((row) => row.recoveryMs ?? []).sort((a, b) => a - b);
      const count = times.length;
      const medianMs = count
        ? (times[Math.floor((count - 1) / 2)]! + times[Math.floor(count / 2)]!) / 2
        : null;
      return [
        {
          condition,
          arm,
          samples: group.length,
          recovered: count,
          recoveryRate: count / group.length,
          medianMs,
          p95Ms: times[Math.ceil(count * 0.95) - 1] ?? null,
          duplicateProbes: group.filter((row) => row.extraDebitCount !== null).length,
          extraDebits: group.reduce((sum, row) => sum + (row.extraDebitCount ?? 0), 0),
          unableToContinue: group.filter((row) => !row.couldContinue).length,
        },
      ];
    }),
  );
}
