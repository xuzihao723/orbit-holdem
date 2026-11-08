import type { QueryRequestMap } from '@orbit/protocol';
import { fields, isUuid, integer, text, PayloadError } from './input.js';
export function parseQuery<K extends keyof QueryRequestMap>(
  event: K,
  value: unknown,
): QueryRequestMap[K] {
  const r =
    event === 'history:list'
      ? fields(value, ['requestId', 'cursor', 'limit'], ['limit'])
      : fields(value, ['requestId', 'handId']);
  if (!isUuid(r.requestId)) throw new PayloadError('requestId', 'invalidFormat');
  if (event === 'history:list') {
    r.cursor = r.cursor === null ? null : text(r.cursor, 'cursor', 1024);
    r.limit = r.limit === undefined ? 20 : integer(r.limit, 'limit');
    if ((r.limit as number) < 1 || (r.limit as number) > 50)
      throw new PayloadError('limit', 'outOfRange');
  } else r.handId = text(r.handId, 'handId');
  return Object.freeze(r) as unknown as QueryRequestMap[K];
}
