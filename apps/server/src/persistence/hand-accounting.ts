import type { EventInsert } from './rows.js';
import { object, integer } from './rows.js';
import { invalid } from './errors.js';
export function eventStackDelta(events: readonly EventInsert[], seatId: number): number {
  let delta = 0;
  for (const e of events) {
    const p = object(e.payload);
    if (p.seatId !== seatId) continue;
    if (e.kind === 'actionApplied') delta -= integer(p.paidAmount);
    if (e.kind === 'blindPosted') delta -= integer(p.amount);
    if (e.kind === 'refunded' || e.kind === 'paidOut') delta += integer(p.amount);
  }
  if (!Number.isSafeInteger(delta)) invalid();
  return delta;
}
