import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
const rows: {
  id: string;
  path: string;
  author: string;
  sourceUrl: null;
  acquiredAt: string;
  license: string;
  sourceFile: string;
  generator: string;
  modifications: string;
  sha256: string;
}[] = [];
function save(path: string, id: string, body: string, viewBox = '0 0 128 128') {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' +
    viewBox +
    '" data-asset-id="' +
    id +
    '"><title>' +
    id +
    '</title>' +
    body +
    '</svg>';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, svg);
  rows.push({
    id,
    path,
    author: 'Orbit project contributors',
    sourceUrl: null,
    acquiredAt: '2026-11-01',
    license: 'CC0-1.0',
    sourceFile: 'scripts/generate-aux-assets.ts',
    generator: 'Original code-native SVG, with coding assistance',
    modifications: 'Original creation',
    sha256: createHash('sha256').update(svg).digest('hex'),
  });
}
const colors = ['#D6B878', '#67C7AD', '#8DAFD0', '#D59894'];
for (let n = 1; n <= 4; n++) {
  const num = String(n).padStart(2, '0'),
    color = colors[n - 1]!;
  save(
    'assets/avatars/human-' + num + '.svg',
    'human-' + num,
    '<circle cx="64" cy="64" r="60" fill="#183545" stroke="' +
      color +
      '" stroke-width="3"/>' +
      '<path d="M28 111Q30 79 64 78Q98 79 100 111" fill="' +
      color +
      '"/><circle cx="64" cy="51" r="24" fill="#F7F2E8"/>' +
      '<path d="' +
      [
        'M40 45Q52 10 86 37L75 38L40 53Z',
        'M39 53Q34 19 65 23Q92 22 89 58L80 42L48 39Z',
        'M40 45L42 28L60 34L82 24L88 45Z',
        'M40 39Q64 17 88 39L88 47L40 47Z',
      ][n - 1] +
      '" fill="#17212B"/>',
  );
  save(
    'assets/avatars/bot-' + num + '.svg',
    'bot-' + num,
    '<rect x="6" y="6" width="116" height="116" rx="' +
      (8 + n * 4) +
      '" fill="#183545" stroke="' +
      color +
      '" stroke-width="3"/>' +
      '<path d="M64 19V32M47 19H81" stroke="' +
      color +
      '" stroke-width="3"/><rect x="27" y="33" width="74" height="61" rx="12" fill="#F7F2E8"/>' +
      '<path d="M40 55H53M75 55H88M43 ' +
      (71 + n) +
      'H85" stroke="#17212B" stroke-width="' +
      (2 + n) +
      '"/>' +
      '<path d="M37 107H91" stroke="' +
      color +
      '" stroke-width="6"/>',
  );
}
for (const [i, value] of [1, 5, 25, 100, 500].entries())
  save(
    'assets/table/chip-' + value + '.svg',
    'chip-' + value,
    '<circle cx="64" cy="64" r="59" fill="' +
      (i === 0 ? '#F7F2E8' : '#183545') +
      '" stroke="#D6B878" stroke-width="5"/>' +
      '<circle cx="64" cy="64" r="45" fill="none" stroke="' +
      (i === 0 ? '#17212B' : '#F7F2E8') +
      '" stroke-width="2" stroke-dasharray="8 7"/>' +
      '<text x="64" y="77" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="34" font-weight="600" fill="' +
      (i === 0 ? '#17212B' : '#F7F2E8') +
      '">' +
      value +
      '</text>',
  );
for (const [name, text] of [
  ['dealer', 'D'],
  ['sb', 'SB'],
  ['bb', 'BB'],
])
  save(
    'assets/table/' + name + '.svg',
    name!,
    '<circle cx="64" cy="64" r="57" fill="#F7F2E8" stroke="#D6B878" stroke-width="4"/><text x="64" y="79" text-anchor="middle" fill="#17212B" font-family="Segoe UI, sans-serif" font-size="42" font-weight="600">' +
      text +
      '</text>',
  );
for (const name of ['table', 'background'])
  save(
    'assets/table/' + name + '-texture.svg',
    name + '-texture',
    '<rect width="128" height="128" fill="' +
      (name === 'table' ? '#183545' : '#101827') +
      '"/><g fill="none" stroke="#B5C0CC" stroke-opacity=".08"><circle cx="64" cy="64" r="43"/><path d="M0 64H128M64 0V128M9 9L119 119"/></g>',
  );
const icons: Record<string, string> = {
  'sound-on': 'M5 10H9L15 5V23L9 18H5ZM19 8Q25 14 19 20',
  'sound-off': 'M5 10H9L15 5V23L9 18H5ZM19 10L25 18M25 10L19 18',
  settings:
    'M14 3V7M14 21V25M3 14H7M21 14H25M6 6L9 9M19 19L22 22M22 6L19 9M9 19L6 22M14 9A5 5 0 1 0 14 19A5 5 0 1 0 14 9',
  close: 'M7 7L21 21M21 7L7 21',
  copy: 'M10 9H23V24H10ZM5 19V4H18',
  back: 'M13 6L5 14L13 22M5 14H24',
  play: 'M9 5L23 14L9 23Z',
  pause: 'M9 5V23M19 5V23',
  next: 'M6 5L19 14L6 23ZM23 5V23',
  previous: 'M22 5L9 14L22 23ZM5 5V23',
  help: 'M10 9Q10 4 15 5Q23 7 16 13L14 16M14 21V23',
  connection: 'M4 11Q14 1 24 11M8 15Q14 9 20 15M12 19Q14 17 16 19M14 23V24',
};
for (const [id, path] of Object.entries(icons))
  save(
    'assets/icons/' + id + '.svg',
    id,
    '<path d="' +
      path +
      '" fill="none" stroke="#F7F2E8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    '0 0 28 28',
  );
save(
  'assets/states/empty-history.svg',
  'empty-history',
  '<circle cx="64" cy="62" r="43" fill="none" stroke="#D6B878" stroke-width="3"/><path d="M64 34V65L83 77M34 111H94" fill="none" stroke="#B5C0CC" stroke-width="3"/>',
);
save(
  'assets/states/room-full.svg',
  'room-full',
  '<g fill="#D6B878">' +
    [30, 98]
      .flatMap((x) => [30, 98].map((y) => '<circle cx="' + x + '" cy="' + y + '" r="18"/>'))
      .join('') +
    '</g><path d="M47 64H81M64 47V81" stroke="#B5C0CC" stroke-width="3"/>',
);
save(
  'assets/states/connection-failed.svg',
  'connection-failed',
  '<path d="M18 47Q64 5 110 47M32 65Q64 33 96 65M47 82L57 75M72 75L81 82M64 95V101M20 19L108 109" fill="none" stroke="#D6B878" stroke-width="4" stroke-linecap="round"/>',
);
save(
  'assets/brand/app-icon.svg',
  'app-icon',
  '<rect x="4" y="4" width="120" height="120" rx="26" fill="#183545" stroke="#D6B878" stroke-width="3"/><circle cx="64" cy="64" r="38" fill="none" stroke="#D6B878" stroke-width="2"/><path d="M64 21L75 55L107 64L75 73L64 107L53 73L21 64L53 55Z" fill="#D6B878"/>',
);
save(
  'assets/brand/wordmark.svg',
  'wordmark',
  '<path d="M28 8L33 26L50 31L33 36L28 54L23 36L6 31L23 26Z" fill="#D6B878"/><text x="65" y="41" fill="#F7F2E8" font-family="Segoe UI, sans-serif" font-size="30" letter-spacing="2">ORBIT HOLD’EM</text>',
  '0 0 340 64',
);
writeFileSync(
  'assets/aux-manifest.json',
  JSON.stringify({ schemaVersion: 1, assets: rows }, null, 2) + '\n',
);
console.log(JSON.stringify({ visualAssets: rows.length }));
