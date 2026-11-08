import type { Suit } from '@orbit/protocol';
export interface CardComponent {
  id: string;
  svg: string;
  bounds: { x: number; y: number; width: number; height: number };
}
// Original normalized paths, 24 by 24. Their identity never depends on a font.
export const suits: Record<Suit, CardComponent> = {
  S: {
    id: 'suit-S',
    svg: '<path d="M0 -12C-3 -7 -11 -3 -11 3C-11 9 -4 10 -1 5L-4 12H4L1 5C4 10 11 9 11 3C11 -3 3 -7 0 -12Z"/>',
    bounds: { x: -12, y: -12, width: 24, height: 24 },
  },
  H: {
    id: 'suit-H',
    svg: '<path d="M0 12C-3 7 -11 1 -11 -5C-11 -13 -2 -14 0 -6C2 -14 11 -13 11 -5C11 1 3 7 0 12Z"/>',
    bounds: { x: -12, y: -13, width: 24, height: 25 },
  },
  C: {
    id: 'suit-C',
    svg: '<path d="M0 -12C-7 -12 -8 -3 -3 -1C-13 -5 -15 8 -7 9C-3 10 -1 6 -1 5L-4 12H4L1 5C2 10 10 12 12 5C14 -2 6 -5 3 -1C8 -3 7 -12 0 -12Z"/>',
    bounds: { x: -14, y: -12, width: 28, height: 24 },
  },
  D: {
    id: 'suit-D',
    svg: '<path d="M0 -13L10 0L0 13L-10 0Z"/>',
    bounds: { x: -10, y: -13, width: 20, height: 26 },
  },
};
export function suitMark(
  suit: Suit,
  x: number,
  y: number,
  scale = 1,
  rotation = 0,
  attributes = '',
) {
  return (
    '<g ' +
    attributes +
    ' transform="translate(' +
    x +
    ' ' +
    y +
    ') rotate(' +
    rotation +
    ') scale(' +
    scale +
    ')" fill="var(--card-suit,' +
    (suit === 'H' || suit === 'D' ? '#B83A48' : '#17212B') +
    ')">' +
    suits[suit].svg +
    '</g>'
  );
}
