import type { Rank, Suit } from '@orbit/protocol';
import { suits, suitMark, type CardComponent } from '../../assets/cards/templates/suits.js';
import { pipLayouts } from '../../assets/cards/templates/pip-layouts.js';
import { renderAce } from '../../assets/cards/templates/aces/index.js';
import { renderCourt } from '../../assets/cards/templates/figures/index.js';
export { renderAce, renderCourt };
export function renderCenter(rank: Rank, suit: Suit): CardComponent {
  if (!Object.hasOwn(suits, suit)) throw Error('INVALID_COMPONENT');
  if (rank === 'A') return renderAce(suit);
  if (rank === 'J' || rank === 'Q' || rank === 'K') return renderCourt(rank, suit);
  if (!Object.hasOwn(pipLayouts, rank)) throw Error('INVALID_COMPONENT');
  const pips = pipLayouts[rank as keyof typeof pipLayouts];
  return {
    id: rank + suit,
    svg: pips
      .map((p, i) =>
        suitMark(
          suit,
          p.x,
          p.y,
          1.05,
          p.rotation,
          'data-pip-index="' + i + '" data-center-suit="' + suit + '"',
        ),
      )
      .join(''),
    bounds: { x: 66, y: 96, width: 108, height: 144 },
  };
}
