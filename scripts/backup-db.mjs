import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, linkSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, join, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkBackup } from './lib/backup-check.mjs';
export async function backupDatabase(sourcePath, outputPath, { timeoutMs = 60000 } = {}) {
  const source = resolve(sourcePath),
    output = resolve(outputPath),
    parent = dirname(output);
  if (
    !existsSync(source) ||
    source === output ||
    existsSync(output) ||
    existsSync(output + '.json')
  )
    throw Error('BACKUP_PATH_INVALID_OR_EXISTS');
  if (process.env.WEB_DIST && output.startsWith(resolve(process.env.WEB_DIST) + sep))
    throw Error('BACKUP_INSIDE_WEB_DIST');
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, '.orbit-backup-')),
    snapshot = join(stage, 'snapshot.sqlite');
  let published = false,
    manifestPublished = false;
  try {
    await new Promise((resolvePromise, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./backup-worker.mjs', import.meta.url)), source, snapshot],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let finished = false,
        stderr = '',
        stdout = '';
      const timer = setTimeout(() => {
        if (!finished) {
          child.kill();
        }
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout = (stdout + chunk).slice(-8192);
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-8192);
      });
      child.once('error', (error) => {
        finished = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        finished = true;
        clearTimeout(timer);
        if (code === 0 && !signal) resolvePromise(stdout);
        else reject(Error('BACKUP_WORKER_FAILED_OR_TIMED_OUT'));
      });
    });
    const checked = checkBackup(snapshot);
    const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), ...checked };
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    // Hard links publish with exclusive destination semantics; no overwrite race.
    linkSync(snapshot, output);
    published = true;
    linkSync(join(stage, 'manifest.json'), output + '.json');
    manifestPublished = true;
    return manifest;
  } catch (error) {
    if (manifestPublished) rmSync(output + '.json');
    if (published) rmSync(output);
    throw error;
  } finally {
    if (dirname(resolve(stage)) !== parent || !basename(stage).startsWith('.orbit-backup-'))
      throw Error('BACKUP_STAGING_ESCAPE');
    rmSync(stage, { recursive: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2),
      source = args[args.indexOf('--source') + 1],
      out = args[args.indexOf('--out') + 1];
    if (!args.includes('--source') || !args.includes('--out') || !source || !out)
      throw Error('Usage: db:backup -- --source PATH --out NEW_PATH');
    console.log(JSON.stringify(await backupDatabase(source, out)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
