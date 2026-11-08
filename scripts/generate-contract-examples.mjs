import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mutationEvents = new Set([
  'room:create',
  'room:join',
  'room:ready',
  'room:capacity:set',
  'room:bot:add',
  'room:bot:remove',
  'room:start',
  'game:action',
  'room:leave',
  'room:reset:propose',
  'room:reset:cancel',
]);
const privateEvents = new Set(['session:guest', 'session:resume', 'history:list', 'replay:get']);
const serverEvents = new Set([
  'command:ack',
  'room:view',
  'game:view',
  'game:result',
  'session:status',
]);

try {
  const input =
    process.argv[2] ?? fileURLToPath(new URL('../docs/examples/protocol.json', import.meta.url));
  const output =
    process.argv[3] ??
    fileURLToPath(new URL('../tests/contracts/generated/protocol-examples.ts', import.meta.url));
  const examples = JSON.parse(await readFile(input, 'utf8'));
  if (!Array.isArray(examples) || examples.length === 0)
    throw new Error('Examples must be a non-empty array');
  const lines = [
    '// Generated from protocol.json. Regenerated before every typecheck.',
    "import type { ClientRequestMap, CommandAck, PrivateResponseMap, ServerEventMap } from '@orbit/protocol';",
  ];
  for (const [index, example] of examples.entries()) {
    if (!mutationEvents.has(example.event) && !privateEvents.has(example.event)) {
      throw new Error(`Unknown client event: ${example.event}`);
    }
    const key = JSON.stringify(example.event);
    const id = String(index + 1).padStart(2, '0');
    lines.push(
      `export const request${id} = ${JSON.stringify(example.request, null, 2)} satisfies ClientRequestMap[${key}];`,
    );
    const responseType = mutationEvents.has(example.event)
      ? 'CommandAck'
      : `PrivateResponseMap[${key}]`;
    lines.push(
      `export const response${id} = ${JSON.stringify(example.response, null, 2)} satisfies ${responseType};`,
    );
    for (const [eventIndex, emission] of example.emittedEvents.entries()) {
      if (!serverEvents.has(emission.event))
        throw new Error(`Unknown server event: ${emission.event}`);
      lines.push(
        `export const emission${id}_${eventIndex} = ${JSON.stringify(emission.payload, null, 2)} satisfies ServerEventMap[${JSON.stringify(emission.event)}];`,
      );
    }
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, lines.join('\n\n') + '\n', 'utf8');
  console.info(`Generated typed contracts for ${examples.length} examples.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
