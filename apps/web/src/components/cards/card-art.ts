import manifest from '../../../../../assets/cards/manifest.json';
import type { CardId } from '@orbit/protocol';
const sources = import.meta.glob<string>(
  ['../../../../../assets/cards/backs/*.svg', '../../../../../assets/cards/slot.svg'],
  { query: '?raw', import: 'default', eager: true },
);
const faceSources = import.meta.env.DEV
  ? import.meta.glob<string>('../../../../../assets/cards/faces/*.svg', {
      query: '?raw',
      import: 'default',
      eager: true,
    })
  : {};
function load(path: string, entries = sources) {
  const svg = entries['../../../../../assets/' + path];
  if (!svg) throw Error('MISSING_TRUSTED_CARD_ART');
  return svg;
}
export const cardArt = (
  import.meta.env.DEV
    ? Object.fromEntries(
        Object.entries(manifest.faces).map(([id, path]) => [id, load(path, faceSources)]),
      )
    : {}
) as Record<CardId, string>;
export const backArt = {
  orbit: load(manifest.backs[0]!),
  'orbit-simple': load(manifest.backs[1]!),
};
export const slotArt = load(manifest.slot);
