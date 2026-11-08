import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
interface Source {
  id: string;
  path: string;
  license: string;
  sourceFile: string;
  sha256: string;
  author: string;
  acquiredAt: string;
}
export function validateAuxAssets() {
  const m = JSON.parse(readFileSync('assets/aux-manifest.json', 'utf8')) as {
    schemaVersion: number;
    assets: Source[];
  };
  if (
    m.schemaVersion !== 1 ||
    m.assets.length !== 45 ||
    new Set(m.assets.map((r) => r.id)).size !== 45
  )
    throw Error('INVALID_AUX_MANIFEST');
  const counts = {
    avatars: 0,
    markers: 0,
    textures: 0,
    icons: 0,
    states: 0,
    brand: 0,
    audio: 0,
    sources: m.assets.length,
  };
  const svgs: Record<string, string> = {};
  for (const r of m.assets) {
    if (
      !/^assets\/(?:avatars|table|icons|states|brand|audio)\/[a-z0-9-]+\.(svg|ogg|mp3)$/.test(
        r.path,
      ) ||
      r.license !== 'CC0-1.0' ||
      !r.author ||
      !r.acquiredAt ||
      !existsSync(r.sourceFile)
    )
      throw Error('INVALID_AUX_SOURCE');
    const bytes = readFileSync(r.path);
    if (createHash('sha256').update(bytes).digest('hex') !== r.sha256)
      throw Error('AUX_HASH_MISMATCH');
    if (r.path.endsWith('.svg')) svgs[r.id] = bytes.toString('utf8');
    if (r.path.includes('/avatars/')) counts.avatars++;
    else if (r.path.includes('/table/'))
      r.id.endsWith('texture') ? counts.textures++ : counts.markers++;
    else if (r.path.includes('/icons/')) counts.icons++;
    else if (r.path.includes('/states/')) counts.states++;
    else if (r.path.includes('/brand/')) counts.brand++;
    else {
      counts.audio++;
      if (
        r.path.endsWith('.ogg')
          ? bytes.subarray(0, 4).toString() !== 'OggS'
          : bytes.subarray(0, 3).toString() !== 'ID3' && !(bytes[0] === 255 && bytes[1]! >= 224)
      )
        throw Error('FAKE_AUDIO_FORMAT');
    }
  }
  const result = spawnSync('python', ['-X', 'utf8', 'scripts/lib/inspect-aux-svg.py'], {
    input: JSON.stringify(svgs),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  if (result.status !== 0) throw Error('UNSAFE_AUX_SVG: ' + result.stderr);
  if (
    JSON.stringify(counts) !==
    JSON.stringify({
      avatars: 8,
      markers: 8,
      textures: 2,
      icons: 12,
      states: 3,
      brand: 2,
      audio: 10,
      sources: 45,
    })
  )
    throw Error('MISSING_AUX_CATEGORY');
  return counts;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(validateAuxAssets()));
