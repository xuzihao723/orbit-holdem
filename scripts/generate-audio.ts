import { mkdirSync, writeFileSync } from 'node:fs';
const profiles = {
  deal: [0.16, 740, 340],
  flip: [0.12, 420, 920],
  action: [0.1, 180, 260],
  win: [0.42, 523.25, 783.99],
  join: [0.22, 392, 659.25],
} as const;
mkdirSync('assets/sources/audio', { recursive: true });
for (const [id, [duration, from, to]] of Object.entries(profiles)) {
  const rate = 48000,
    count = Math.round(duration * rate),
    buffer = Buffer.alloc(44 + count * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      envelope = Math.sin((Math.PI * i) / (count - 1)) ** 2,
      phase = 2 * Math.PI * (from * t + ((to - from) / (2 * duration)) * t * t);
    buffer.writeInt16LE(
      Math.round(32767 * 0.3 * envelope * (0.8 * Math.sin(phase) + 0.2 * Math.sin(phase * 2))),
      44 + i * 2,
    );
  }
  writeFileSync('assets/sources/audio/' + id + '.wav', buffer);
}
writeFileSync(
  'assets/sources/audio/parameters.json',
  JSON.stringify(
    {
      sampleRate: 48000,
      channels: 1,
      bits: 16,
      peakScale: 0.3,
      envelope: 'sin(pi*n/(N-1))^2',
      profiles,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ wavMasters: 5 }));
