import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
const script = fileURLToPath(new URL('../../scripts/verify-preview-bundle.mjs', import.meta.url));
function probe(contents: string, index = true) {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-w04-bundle-'));
  try {
    if (index)
      writeFileSync(join(directory, 'index.html'), '<html><script src="entry.js"></script></html>');
    writeFileSync(join(directory, 'entry.js'), 'console.log("production entry")');
    // main.js intentionally has no incoming import; scan all shipped chunks anyway.
    writeFileSync(join(directory, 'main.js'), contents);
    return spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
  } finally {
    if (index) unlinkSync(join(directory, 'index.html'));
    unlinkSync(join(directory, 'main.js'));
    unlinkSync(join(directory, 'entry.js'));
    rmdirSync(directory);
  }
}
it('accepts an existing built entry with no development fixture markers', () => {
  const result = probe('console.log("production home")');
  expect(result.status, result.stderr).toBe(0);
});
it('rejects actual fixture labels even if shipped in an unreferenced chunk', () => {
  for (const marker of ['W04_DEV_FIXTURE_ONLY', 'W04校对昵称甲', 'W32_DEV_COMPONENTS_ONLY']) {
    const result = probe(`console.log("${marker}")`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Development fixture');
  }
});
it('refuses missing build output instead of reporting an empty pass', () => {
  const result = probe('console.log("entry missing")', false);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('index.html');
});
