export type EffectKind = 'deal' | 'flip' | 'action' | 'win' | 'join';
export interface ConfirmedEffect {
  key: string;
  kind: EffectKind;
  handId: string | null;
}
export interface EffectSnapshot {
  epoch: string;
  session: string;
  room: string;
  handId: string | null;
  version: number;
  sequence: number;
  board: number;
  holes: number;
  seats: number;
  settled: boolean;
  ready: boolean;
}
export function createEffectCursor({ maxKeys = 256 }: { maxKeys?: number } = {}) {
  const seen = new Set<string>();
  return {
    get size() {
      return seen.size;
    },
    clear: () => seen.clear(),
    accept: (e: ConfirmedEffect) => {
      if (seen.has(e.key)) return false;
      seen.add(e.key);
      while (seen.size > maxKeys) seen.delete(seen.values().next().value!);
      return true;
    },
  };
}
export function deriveEffects(
  previous: EffectSnapshot | null,
  next: EffectSnapshot,
): ConfirmedEffect[] {
  if (
    !previous ||
    !previous.ready ||
    !next.ready ||
    previous.session !== next.session ||
    previous.epoch !== next.epoch ||
    previous.room !== next.room
  )
    return [];
  const make = (kind: EffectKind): ConfirmedEffect => ({
    kind,
    handId: next.handId,
    key: [next.epoch, next.room, next.handId, next.version, next.sequence, next.seats, kind].join(
      ':',
    ),
  });
  if (next.handId !== previous.handId)
    return (previous.handId === null || previous.settled) && next.version === 1
      ? [make('deal')]
      : [];
  if (next.version === previous.version && next.sequence === previous.sequence)
    return next.seats === previous.seats + 1 ? [make('join')] : [];
  if (next.version !== previous.version + 1 || next.sequence <= previous.sequence) return [];
  const effects = [make('action')];
  if (next.board > previous.board) effects.push(make('flip'));
  if (next.settled && !previous.settled) effects.push(make('win'));
  return effects;
}
