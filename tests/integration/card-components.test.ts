import { expect, test } from 'vitest';
import { suits } from '../../assets/cards/templates/suits.js';
import { pipLayouts } from '../../assets/cards/templates/pip-layouts.js';
import { renderAce, renderCourt, renderCenter } from '../../scripts/lib/card-components.js';
test('all suits, exact pip counts, four aces and twelve courts have consistent identities', () => {
  expect(Object.keys(suits).sort()).toEqual(['C', 'D', 'H', 'S']);
  const ids = new Set<string>();
  for (const suit of ['S', 'H', 'C', 'D'] as const) {
    expect(suits[suit].svg).not.toContain('<text');
    const ace = renderAce(suit);
    ids.add(ace.id);
    expect(ace.svg).toContain('data-ace="' + suit + '"');
    for (const rank of ['J', 'Q', 'K'] as const) {
      const art = renderCourt(rank, suit);
      ids.add(art.id);
      expect(art.svg).toContain('data-court="' + rank + suit + '"');
      expect(art.svg).toContain('data-center-suit="' + suit + '"');
    }
    for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10'] as const) {
      expect(pipLayouts[rank]).toHaveLength(Number(rank));
      expect(new Set(pipLayouts[rank].map((p) => p.x + ':' + p.y)).size).toBe(Number(rank));
      const art = renderCenter(rank, suit);
      expect(art.svg.match(/data-pip-index=/g) ?? []).toHaveLength(Number(rank));
      for (const p of pipLayouts[rank]) {
        expect(p.x).toBeGreaterThanOrEqual(72);
        expect(p.x).toBeLessThanOrEqual(168);
        expect(p.y).toBeGreaterThanOrEqual(105);
        expect(p.y).toBeLessThanOrEqual(231);
      }
    }
  }
  expect(ids.size).toBe(16);
  expect(() => renderCenter('X' as 'A', 'S')).toThrow('INVALID_COMPONENT');
});
