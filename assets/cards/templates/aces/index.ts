import type { Suit } from '@orbit/protocol';
import { suitMark, type CardComponent } from '../suits.js';
export function renderAce(suit: Suit): CardComponent {
  const orbit = { S: 0, H: 30, C: 60, D: 90 }[suit];
  return {
    id: 'A' + suit,
    svg:
      '<g data-ace="' +
      suit +
      '" data-center-suit="' +
      suit +
      '"><g fill="none" stroke="#D6B878" stroke-width="2">' +
      '<circle cx="120" cy="168" r="57"/><circle cx="120" cy="168" r="48"/>' +
      '<path transform="rotate(' +
      orbit +
      ' 120 168)" d="M120 101V121M120 215V235M53 168H73M167 168H187"/>' +
      '</g>' +
      suitMark(suit, 120, 168, 2.7) +
      '</g>',
    bounds: { x: 53, y: 101, width: 134, height: 134 },
  };
}
