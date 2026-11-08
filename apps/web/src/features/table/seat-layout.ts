import type { SeatId } from '@orbit/protocol';
export type SeatPosition = 'self' | 'top' | 'upper-left' | 'upper-right' | 'left' | 'right';
export interface SeatPlacement {
  seatId: SeatId;
  position: SeatPosition;
}
export function getSeatPlacements(
  occupied: readonly SeatId[],
  viewer: SeatId | null,
): SeatPlacement[] {
  if (new Set(occupied).size !== occupied.length) throw new Error('Duplicate seat');
  const anchor = viewer ?? 0;
  const sorted = [...occupied].sort((a, b) => ((a - anchor + 4) % 4) - ((b - anchor + 4) % 4));
  const self = viewer !== null && occupied.includes(viewer) ? viewer : null;
  const opponents = sorted.filter((seat) => seat !== self);
  const positions: SeatPosition[] =
    opponents.length <= 1
      ? ['top']
      : opponents.length === 2
        ? ['upper-left', 'upper-right']
        : opponents.length === 3
          ? ['left', 'top', 'right']
          : ['upper-left', 'upper-right', 'left', 'right'];
  const result: SeatPlacement[] = self === null ? [] : [{ seatId: self, position: 'self' }];
  opponents.forEach((seatId, index) => {
    const position = positions[index];
    if (!position) throw new Error('Too many seats');
    result.push({ seatId, position });
  });
  return result;
}
