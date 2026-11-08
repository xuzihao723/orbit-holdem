import { writeFileSync, mkdirSync } from 'node:fs';
import { SAMPLE_IDS, cardSampleSvg } from './lib/card-sample-source.js';
mkdirSync('assets/cards/samples', { recursive: true });
for (const id of SAMPLE_IDS)
  writeFileSync('assets/cards/samples/' + id + '.svg', cardSampleSvg(id));
writeFileSync(
  'assets/cards/samples/manifest.json',
  JSON.stringify(
    {
      scope: 'six-samples',
      viewBox: '0 0 240 336',
      samples: SAMPLE_IDS.map((id) => ({
        id,
        path: id + '.svg',
        source: '../templates/source.svg',
      })),
    },
    null,
    2,
  ) + '\n',
);
