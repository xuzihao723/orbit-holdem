import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ffmpegPath } from './encode-audio.mjs';
const results = [];
for (const id of ['deal', 'flip', 'action', 'win', 'join'])
  for (const format of ['ogg', 'mp3']) {
    const path = 'assets/audio/' + id + '.' + format;
    const decoded = spawnSync(
      ffmpegPath(),
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        path,
        '-f',
        's16le',
        '-acodec',
        'pcm_s16le',
        '-ac',
        '1',
        '-ar',
        '48000',
        'pipe:1',
      ],
      { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 },
    );
    if (decoded.error || decoded.status !== 0) throw Error('AUDIO_DECODE_FAILED: ' + path);
    let peak = 0;
    for (let i = 0; i + 1 < decoded.stdout.length; i += 2)
      peak = Math.max(peak, Math.abs(decoded.stdout.readInt16LE(i)) / 32768);
    const duration = decoded.stdout.length / 2 / 48000;
    if (duration < 0.08 || duration > 0.55 || peak <= 0.001 || peak > 0.5012)
      throw Error('AUDIO_OUT_OF_RANGE: ' + path);
    const master = readFileSync('assets/sources/audio/' + id + '.wav');
    if (
      master.subarray(0, 4).toString() !== 'RIFF' ||
      master.readUInt32LE(24) !== 48000 ||
      master.readUInt16LE(22) !== 1 ||
      master.readUInt16LE(34) !== 16
    )
      throw Error('INVALID_AUDIO_MASTER');
    results.push({
      id,
      format,
      decodedSamples: decoded.stdout.length / 2,
      sampleRate: 48000,
      channels: 1,
      duration,
      peakDbFS: 20 * Math.log10(peak),
    });
  }
writeFileSync(
  'docs/verification/' + (process.env.ORBIT_VERIFY_STAGE ?? 'scratch') + '-audio.json',
  JSON.stringify({ decoded: true, listenedByHuman: false, files: results }, null, 2) + '\n',
);
console.log(JSON.stringify({ decoded: results.length, peakBelowMinus6Db: true }));
