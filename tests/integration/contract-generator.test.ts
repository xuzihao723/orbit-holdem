import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../scripts/generate-contract-examples.mjs', import.meta.url),
);
const fixture = fileURLToPath(new URL('../../docs/examples/protocol.json', import.meta.url));
const temporary: Array<{ directory: string; input: string; output: string }> = [];

afterEach(() => {
  for (const entry of temporary.splice(0)) {
    for (const file of [entry.input, entry.output]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(entry.directory);
  }
});

function files() {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-contract-'));
  const entry = {
    directory,
    input: join(directory, 'input.json'),
    output: join(directory, 'output.ts'),
  };
  temporary.push(entry);
  return entry;
}

it('turns all original samples into literal satisfies checks without unsafe casts', () => {
  const entry = files();
  writeFileSync(entry.input, readFileSync(fixture));
  const result = spawnSync(process.execPath, [script, entry.input, entry.output], {
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  const generated = readFileSync(entry.output, 'utf8');
  expect(generated.match(/satisfies ClientRequestMap\[/g)).toHaveLength(14);
  expect(generated.match(/satisfies (?:CommandAck|PrivateResponseMap\[)/g)).toHaveLength(14);
  expect(generated).toContain('satisfies ServerEventMap["game:view"]');
  expect(generated).not.toMatch(/\bas\s+(?:any|unknown)\b/);
});

it('rejects unrecognized event names rather than emitting an unchecked contract', () => {
  const entry = files();
  writeFileSync(entry.input, JSON.stringify([{ id: 'bad', event: 'system:deal' }]));
  const result = spawnSync(process.execPath, [script, entry.input, entry.output], {
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Unknown client event');
  expect(existsSync(entry.output)).toBe(false);
});
