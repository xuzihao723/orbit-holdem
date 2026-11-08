import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../apps/web/dist', import.meta.url));
const markers = [
  'W04_DEV_FIXTURE_ONLY',
  'W04校对昵称甲',
  'W29_DEV_CARD_SAMPLES_ONLY',
  'W32_DEV_COMPONENTS_ONLY',
  'W33_DEV_CARD_CATALOG_ONLY',
  'W34_DEV_AUX_ASSETS_ONLY',
];
function filesIn(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesIn(join(path, entry.name)) : [join(path, entry.name)],
  );
}
try {
  if (!existsSync(join(directory, 'index.html')))
    throw new Error('Missing built index.html; run npm run build first');
  const files = filesIn(directory).filter((path) =>
    ['.html', '.js', '.json', '.css'].includes(extname(path)),
  );
  if (!files.some((path) => extname(path) === '.js')) throw new Error('Missing built JavaScript');
  for (const path of files) {
    const contents = readFileSync(path, 'utf8');
    if (markers.some((marker) => contents.includes(marker)))
      throw new Error('Development fixture leaked into production: ' + path);
  }
  console.log(
    `Production preview boundary passed: ${files.length} files, no development fixture markers.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
