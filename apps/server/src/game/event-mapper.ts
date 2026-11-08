import type { HandEvent, HandState } from '@orbit/poker-core';
import type { EventInsert } from '../persistence/rows.js';
export function mapHandEvents(
  state: HandState,
  events: readonly HandEvent[],
  now: number,
): EventInsert[] {
  return events.map((e) => {
    const { kind, visibility, sequence, handVersion, ...data } = e;
    let payload: unknown = data;
    if (kind === 'cardBurned') payload = { count: 1 };
    const owner =
      kind === 'holeDealt' ? state.players.find((p) => p.seatId === e.seatId)!.participantId : null;
    return {
      handId: state.handId,
      sequence,
      handVersion,
      kind,
      payload,
      visibility,
      ownerParticipantId: owner,
      occurredAt: now,
    };
  });
}
