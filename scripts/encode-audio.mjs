import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return resolve(process.env.FFMPEG_PATH);
  const dir = resolve('.tools/audio-encoder/imageio_ffmpeg/binaries');
  if (existsSync(dir)) {
    const name = readdirSync(dir).find(
      (n) => n.startsWith('ffmpeg-') && (process.platform !== 'win32' || n.endsWith('.exe')),
    );
    if (name) return resolve(dir, name);
  }
  return 'ffmpeg';
}
export function runEncoder(args) {
  const r = spawnSync(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error || r.status !== 0)
    throw Error('ENCODER_FAILED: ' + (r.error?.message ?? r.stderr.slice(-500)));
  return r;
}
export function encodeAudio() {
  mkdirSync('assets/audio', { recursive: true });
  const manifest = JSON.parse(readFileSync('assets/aux-manifest.json', 'utf8'));
  manifest.assets = manifest.assets.filter((r) => !r.path.startsWith('assets/audio/'));
  const commands = [];
  for (const id of ['deal', 'flip', 'action', 'win', 'join'])
    for (const format of ['ogg', 'mp3']) {
      const path = 'assets/audio/' + id + '.' + format,
        source = 'assets/sources/audio/' + id + '.wav';
      const args = [
        '-y',
        '-i',
        source,
        '-c:a',
        format === 'ogg' ? 'libvorbis' : 'libmp3lame',
        '-q:a',
        '4',
        path,
      ];
      runEncoder(args);
      commands.push({ id, format, args });
      manifest.assets.push({
        id: id + '-' + format,
        path,
        author: 'Orbit project contributors',
        sourceUrl: null,
        acquiredAt: '2026-11-01',
        license: 'CC0-1.0',
        sourceFile: source,
        generator: 'scripts/generate-audio.ts + FFmpeg',
        modifications: 'Deterministic synthesis and encoding',
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      });
    }
  writeFileSync('assets/aux-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(
    'assets/sources/audio/encoding.json',
    JSON.stringify(
      {
        version: runEncoder(['-version']).stdout.split('\n')[0],
        binarySha256: existsSync(ffmpegPath())
          ? createHash('sha256').update(readFileSync(ffmpegPath())).digest('hex')
          : null,
        toolSource: 'https://github.com/imageio/imageio-ffmpeg',
        packageVersion: '0.6.0',
        commands,
      },
      null,
      2,
    ) + '\n',
  );
  return { encoded: 10 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(encodeAudio()));
