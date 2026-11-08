import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  validateCardSamples,
  inspectCardSvg,
  contrastRatio,
} from '../../scripts/validate-card-samples.js';
import { cardSampleSvg } from '../../scripts/lib/card-sample-source.js';
it('validates six actual SVG samples and their matching editable source and provenance', () => {
  const r = validateCardSamples();
  expect(r.ids.sort()).toEqual(['AS', '7H', 'JC', 'QD', 'KS', 'orbit-back'].sort());
  expect(r.scope).toBe('six-samples');
  expect(r.pipCount).toBe(7);
  for (const id of r.ids)
    expect(readFileSync('assets/cards/samples/' + id + '.svg', 'utf8')).toBe(cardSampleSvg(id));
});
it.each([
  '<script/>',
  '<foreignObject/>',
  '<image href="https://example.com/x.png"/>',
  '<path onclick="alert(1)"/>',
  '<style>@font-face{src:url(https://example.com/x)}</style>',
])('rejects nonportable active or external SVG content %s', (content) => {
  const svg = cardSampleSvg('7H').replace('</svg>', content + '</svg>');
  expect(() => inspectCardSvg(svg, '7H')).toThrow();
});
it('rejects a mislabeled 7H and requires its exact seven pips', () => {
  expect(() =>
    inspectCardSvg(cardSampleSvg('7H').replace('data-card-id="7H"', 'data-card-id="8H"'), '7H'),
  ).toThrow();
  expect(() =>
    inspectCardSvg(cardSampleSvg('7H').replace('data-pip="heart"', 'data-pip="missing"'), '7H'),
  ).toThrow();
});
it.each(['#17212B', '#B83A48', '#17603F', '#2754A5'])(
  'keeps %s readable on the card face',
  (color) => expect(contrastRatio(color, '#F7F2E8')).toBeGreaterThanOrEqual(4.5),
);
