import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createDeck } from '@orbit/poker-core';
import type { CardSet, CardManifest } from './lib/card-set.js';
export function validateCardSet(set: CardSet) {
  const m = set.manifest,
    deck = createDeck();
  if (
    JSON.stringify(Object.keys(m).sort()) !==
      JSON.stringify(['backs', 'faces', 'schemaVersion', 'slot', 'themeId']) ||
    m.schemaVersion !== 1 ||
    m.themeId !== 'orbit' ||
    Object.keys(m.faces).sort().join() !== deck.sort().join() ||
    m.backs.join() !== 'cards/backs/orbit.svg,cards/backs/orbit-simple.svg' ||
    m.slot !== 'cards/slot.svg'
  )
    throw Error('INVALID_MANIFEST');
  for (const id of deck)
    if (m.faces[id] !== 'cards/faces/' + id + '.svg') throw Error('NON_BIJECTIVE_MAP');
  const expected = [...Object.values(m.faces), ...m.backs, m.slot].sort();
  if (Object.keys(set.files).sort().join() !== expected.join() || new Set(expected).size !== 55)
    throw Error('MISSING_OR_EXTRA_ASSET');
  if (set.files[m.backs[0]!] === set.files[m.backs[1]!]) throw Error('IDENTICAL_BACKS');
  const r = spawnSync('python', ['-X', 'utf8', 'scripts/lib/inspect-full-cards.py'], {
    input: JSON.stringify(set),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  if (r.status !== 0) throw Error('INVALID_CARD_SVG: ' + r.stderr.slice(-400));
  return { faceCount: 52, backs: 2, slot: 1, xmlValidated: true };
}
export function validateAssets(root = resolve('assets')) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'cards/manifest.json'), 'utf8'),
  ) as CardManifest;
  const files: Record<string, string> = {};
  for (const path of [...Object.values(manifest.faces), ...manifest.backs, manifest.slot]) {
    if (
      !/^cards\/(?:faces\/(?:[2-9]|10|J|Q|K|A)[SHCD]\.svg|backs\/orbit(?:-simple)?\.svg|slot\.svg)$/.test(
        path,
      )
    )
      throw Error('ASSET_PATH_ESCAPE');
    const full = realpathSync(resolve(root, path));
    if (!full.startsWith(realpathSync(root) + sep)) throw Error('ASSET_SYMLINK_ESCAPE');
    files[path] = readFileSync(full, 'utf8');
  }
  if (
    readdirSync(resolve(root, 'cards/faces')).filter((p) => p.endsWith('.svg')).length !== 52 ||
    readdirSync(resolve(root, 'cards/backs')).filter((p) => p.endsWith('.svg')).length !== 2
  )
    throw Error('EXTRA_EXPORT');
  return validateCardSet({ manifest, files });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(validateAssets()));
