import type { Suit } from '@orbit/protocol';
import { suitMark, type CardComponent } from '../suits.js';
import { figureBody } from './base.js';
export function renderCourt(rank: 'J' | 'Q' | 'K', suit: Suit): CardComponent {
  const instrument = {
    S: 'M74 191L85 178L85 208Z',
    H: 'M155 203Q142 191 153 185Q165 181 167 191Z',
    C: 'M72 191H88M80 183V201',
    D: 'M157 182L169 195L157 208L146 195Z',
  }[suit];
  return {
    id: rank + suit,
    svg:
      '<g data-court="' +
      rank +
      suit +
      '" data-center-suit="' +
      suit +
      '" fill="var(--card-suit,' +
      (suit === 'H' || suit === 'D' ? '#B83A48' : '#17212B') +
      ')" color="var(--card-suit,' +
      (suit === 'H' || suit === 'D' ? '#B83A48' : '#17212B') +
      ')">' +
      figureBody(rank) +
      '<path d="' +
      instrument +
      '" stroke="#D6B878" stroke-width="2"/>' +
      '<circle cx="120" cy="246" r="12" fill="#F7F2E8"/>' +
      suitMark(suit, 120, 246, 0.65) +
      '</g>',
    bounds: { x: 60, y: 85, width: 120, height: 175 },
  };
}
