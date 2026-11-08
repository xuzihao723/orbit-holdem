import { expect, it } from 'vitest';
import { getSeatPlacements } from '../../apps/web/src/features/table/seat-layout';

it('rotates sparse two-person seats without renumbering them', () => {
  expect(getSeatPlacements([1, 3], 3)).toEqual([
    { seatId: 3, position: 'self' },
    { seatId: 1, position: 'top' },
  ]);
});
it('puts three-player opponents in their clockwise upper corners', () => {
  expect(getSeatPlacements([0, 2, 3], 2)).toEqual([
    { seatId: 2, position: 'self' },
    { seatId: 3, position: 'upper-left' },
    { seatId: 0, position: 'upper-right' },
  ]);
});
it('rotates a four-person table around any viewer', () => {
  expect(getSeatPlacements([0, 1, 2, 3], 2)).toEqual([
    { seatId: 2, position: 'self' },
    { seatId: 3, position: 'left' },
    { seatId: 0, position: 'top' },
    { seatId: 1, position: 'right' },
  ]);
});
it('does not invent a self seat for someone waiting for the next hand', () => {
  expect(getSeatPlacements([1, 2], 0)).toEqual([
    { seatId: 1, position: 'upper-left' },
    { seatId: 2, position: 'upper-right' },
  ]);
});
it('rejects duplicate seats and leaves its input unchanged', () => {
  const seats = [3, 1] as const;
  getSeatPlacements(seats, 3);
  expect(seats).toEqual([3, 1]);
  expect(() => getSeatPlacements([1, 1], 1)).toThrow('Duplicate seat');
});
