import { RoomError } from '../rooms/room-types.js';
import type { HistoryAnchor } from '../persistence/history-rows.js';
export function encodeHistoryCursor(sessionId: string, anchor: HistoryAnchor) {
  return Buffer.from(
    JSON.stringify({ v: 1, s: sessionId, t: anchor.startedAt, h: anchor.handId }),
  ).toString('base64url');
}
export function decodeHistoryCursor(value: string | null, sessionId: string): HistoryAnchor | null {
  if (value === null) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 1024) throw Error();
    const x = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      !x ||
      Object.keys(x).sort().join() !== 'h,s,t,v' ||
      x.v !== 1 ||
      x.s !== sessionId ||
      typeof x.h !== 'string' ||
      !x.h ||
      x.h.length > 128 ||
      !Number.isSafeInteger(x.t) ||
      (x.t as number) < 0
    )
      throw Error();
    return { startedAt: x.t as number, handId: x.h };
  } catch {
    throw new RoomError('INVALID_INPUT');
  }
}
