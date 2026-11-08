export type PersistenceCode =
  | 'PERSISTENCE_INVALID_INPUT'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'PERSISTENCE_CONFLICT'
  | 'PERSISTENCE_STALE_VERSION'
  | 'PERSISTENCE_SCHEMA_MISMATCH'
  | 'PERSISTENCE_SESSION_EXPIRED'
  | 'PERSISTENCE_GENERATION_LIMIT'
  | 'NESTED_TRANSACTION'
  | 'ASYNC_TRANSACTION_CALLBACK';
export class PersistenceError extends Error {
  readonly code: PersistenceCode;
  readonly sqliteErrCode: number | null;
  constructor(code: PersistenceCode, sqliteErrCode: number | null = null) {
    super(code);
    this.name = 'PersistenceError';
    this.code = code;
    this.sqliteErrCode = sqliteErrCode;
  }
}
export function databaseError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  const code =
    error && typeof error === 'object' && 'errcode' in error && typeof error.errcode === 'number'
      ? error.errcode
      : null;
  return new PersistenceError(
    code !== null && (code & 255) === 19 ? 'PERSISTENCE_CONFLICT' : 'PERSISTENCE_UNAVAILABLE',
    code,
  );
}
export function invalid(): never {
  throw new PersistenceError('PERSISTENCE_INVALID_INPUT');
}
