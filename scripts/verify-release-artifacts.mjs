import { readdirSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const markers = [
  'W04_DEV_FIXTURE_ONLY',
  'W04校对昵称甲',
  'W29_DEV_CARD_SAMPLES_ONLY',
  'W32_DEV_COMPONENTS_ONLY',
  'W33_DEV_CARD_CATALOG_ONLY',
  'W34_DEV_AUX_ASSETS_ONLY',
  'W35_DEV_COMPONENT_STATES_ONLY',
  'LIFE04',
  'settlementHoleCards',
];
const walk = (path) =>
  readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)],
  );
const files = walk('apps/web/dist');
if (!existsSync('apps/web/dist/index.html') || !files.some((p) => p.endsWith('.js')))
  throw Error('MISSING_RELEASE_BUILD');
for (const file of files) {
  if (
    /(?:\.sqlite(?:-wal|-shm)?|\.env|\.wav)$/.test(file) ||
    /(?:verification|fixtures|tests|backups)[\\/]/.test(file)
  )
    throw Error('PRIVATE_RELEASE_FILE: ' + file);
  if (
    ['.js', '.html', '.css', '.json'].includes(extname(file)) &&
    markers.some((m) => readFileSync(file, 'utf8').includes(m))
  )
    throw Error('FIXTURE_IN_RELEASE: ' + file);
}
const report = {
  files: files.length,
  bytes: files.reduce((n, p) => n + statSync(p).size, 0),
  forbiddenMarkers: markers.length,
  passed: true,
  imageBuilt: false,
  publicDeploymentVerified: false,
};
writeFileSync(
  'docs/verification/' + (process.env.ORBIT_VERIFY_STAGE ?? 'scratch') + '-release-artifacts.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
