import type { HandRow } from './hand-rows.js';
import type { ParticipantRow } from './domain-rows.js';
import { invalid } from './errors.js';
export function validateResultBalances(
  hand: HandRow,
  participants: readonly ParticipantRow[],
): void {
  if (!hand.result) return;
  for (const final of hand.result.finalStacks) {
    const participant = participants.find((p) => p.participantId === final.participantId);
    if (!participant || participant.seatId !== final.seatId || participant.stack !== final.stack)
      invalid();
  }
}
