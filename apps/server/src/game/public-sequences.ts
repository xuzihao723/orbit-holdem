export function publicSequencesAfter(
  events: readonly { sequence: number; visibility: string }[],
  watermark: number,
): number[] {
  return events
    .filter((e) => e.visibility === 'public' && e.sequence > watermark)
    .map((e) => e.sequence);
}
export function lastPublicSequence(
  events: readonly { sequence: number; visibility: string }[],
): number {
  return Math.max(0, ...publicSequencesAfter(events, 0));
}
