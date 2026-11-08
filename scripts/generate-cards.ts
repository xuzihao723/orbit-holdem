import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDeck } from '@orbit/poker-core';
import type { Rank, Suit } from '@orbit/protocol';
import type { CardSet } from './lib/card-set.js';
import { renderCenter } from './lib/card-components.js';
import { suitMark } from '../assets/cards/templates/suits.js';
import { cardSampleSvg } from './lib/card-sample-source.js';
import { validateCardSet } from './validate-assets.js';
export function buildCardSet(): CardSet {
  const template = readFileSync('assets/cards/templates/face-template.svg', 'utf8');
  const set: CardSet = {
    manifest: {
      schemaVersion: 1,
      themeId: 'orbit',
      faces: {},
      backs: ['cards/backs/orbit.svg', 'cards/backs/orbit-simple.svg'],
      slot: 'cards/slot.svg',
    },
    files: {},
  };
  for (const id of createDeck()) {
    const rank = id.slice(0, -1) as Rank,
      suit = id.slice(-1) as Suit;
    const corner =
      '<g data-corner="safe"><text x="34" y="53" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="' +
      (rank === '10' ? 38 : 44) +
      '" font-weight="600" fill="var(--card-suit,' +
      (suit === 'H' || suit === 'D' ? '#B83A48' : '#17212B') +
      ')">' +
      rank +
      '</text>' +
      suitMark(suit, 34, 76, 0.95) +
      '</g>';
    const vars: Record<string, string> = {
      ID: id,
      RANK: rank,
      SUIT: suit,
      CORNERS: corner + '<g transform="rotate(180 120 168)">' + corner + '</g>',
      ART: renderCenter(rank, suit).svg,
    };
    const path = 'cards/faces/' + id + '.svg';
    set.manifest.faces[id] = path;
    set.files[path] = template.replace(/\{\{([A-Z]+)\}\}/g, (_, key: string) => vars[key]!);
  }
  set.files[set.manifest.backs[0]!] = cardSampleSvg('orbit-back');
  const half =
    '<path d="M40 168L120 62L200 168" fill="none" stroke="#D6B878" stroke-width="3"/><circle cx="120" cy="96" r="9" fill="#D6B878"/>';
  set.files[set.manifest.backs[1]!] =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 336" data-card-id="orbit-simple"><title>简洁轨道牌背</title><rect x="1" y="1" width="238" height="334" rx="14" fill="#183545" stroke="#D6B878" stroke-width="2"/><g data-back-half="first">' +
    half +
    '</g><g data-back-half="second" transform="rotate(180 120 168)">' +
    half +
    '</g><circle cx="120" cy="168" r="21" fill="#183545" stroke="#D6B878" stroke-width="2"/></svg>';
  set.files[set.manifest.slot] =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 336" data-card-id="slot"><title>待发公共牌</title><rect x="3" y="3" width="234" height="330" rx="14" fill="none" stroke="#B5C0CC" stroke-width="3" stroke-dasharray="7 7"/><circle cx="120" cy="168" r="5" fill="#B5C0CC"/></svg>';
  return set;
}
export function generateCards() {
  const set = buildCardSet();
  validateCardSet(set);
  const root = resolve('assets'),
    stage = mkdtempSync(join(root, '.orbit-cards-'));
  const originals = new Map<string, Buffer | null>();
  try {
    for (const [rel, svg] of Object.entries(set.files)) {
      const target = join(stage, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, svg);
    }
    const entries = [...Object.keys(set.files), 'cards/manifest.json'];
    writeFileSync(join(stage, 'cards/manifest.json'), JSON.stringify(set.manifest, null, 2) + '\n');
    for (const rel of entries) {
      const target = join(root, rel);
      // Only the closed 55-file set and its own manifest may be published.
      originals.set(target, existsSync(target) ? readFileSync(target) : null);
      mkdirSync(dirname(target), { recursive: true });
      renameSync(join(stage, rel), target);
    }
  } catch (error) {
    for (const [target, bytes] of originals) {
      if (bytes) writeFileSync(target, bytes);
      else if (existsSync(target)) rmSync(target);
    }
    throw error;
  } finally {
    if (dirname(resolve(stage)) !== root || !stage.startsWith(join(root, '.orbit-cards-')))
      throw Error('STAGING_PATH_ESCAPE');
    rmSync(stage, { recursive: true });
  }
  return { faces: 52, backs: 2, slots: 1 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(generateCards()));
