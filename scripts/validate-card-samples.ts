import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SAMPLE_IDS, cardSampleSvg } from './lib/card-sample-source.js';
export function inspectCardSvg(
  svg: string,
  id: string,
): { viewBox: string; pipCount: number; externalReferences: string[] } {
  const r = spawnSync('python', ['-X', 'utf8', 'scripts/lib/inspect-card-svg.py'], {
    input: JSON.stringify({ svg, id }),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  if (r.status !== 0) throw Error('INVALID_CARD_SVG: ' + r.stderr.slice(-300));
  return JSON.parse(r.stdout);
}
export function contrastRatio(a: string, b: string) {
  const lum = (c: string) => {
    const rgb = c
      .replace('#', '')
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  };
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function validateCardSamples() {
  const manifest = JSON.parse(readFileSync('assets/cards/samples/manifest.json', 'utf8')) as {
    scope: string;
    viewBox: string;
    samples: { id: string; path: string; source: string }[];
  };
  if (
    manifest.scope !== 'six-samples' ||
    manifest.samples.length !== 6 ||
    manifest.viewBox !== '0 0 240 336'
  )
    throw Error('INVALID_MANIFEST');
  const provenance = JSON.parse(readFileSync('assets/sources/sample-sources.json', 'utf8')) as {
    samples: { id: string; license: string }[];
  };
  let pipCount = 0;
  for (const id of SAMPLE_IDS) {
    const row = manifest.samples.find((s) => s.id === id),
      source = provenance.samples.find((s) => s.id === id);
    if (
      !row ||
      row.path !== id + '.svg' ||
      row.source !== '../templates/source.svg' ||
      source?.license !== 'CC0-1.0'
    )
      throw Error('MISSING_SOURCE');
    const svg = readFileSync('assets/cards/samples/' + row.path, 'utf8');
    pipCount += inspectCardSvg(svg, id).pipCount;
    if (svg !== cardSampleSvg(id)) throw Error('SOURCE_EXPORT_MISMATCH');
  }
  return { scope: manifest.scope, ids: [...SAMPLE_IDS], pipCount };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(validateCardSamples()));
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
