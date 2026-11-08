import { createDeck } from '@orbit/poker-core';
import type { Rank, Suit } from '@orbit/protocol';
import { renderCenter } from './lib/card-components.js';
import { spawnSync } from 'node:child_process';
for (const id of createDeck()) {
  const c = renderCenter(id.slice(0, -1) as Rank, id.slice(-1) as Suit);
  const result = spawnSync('python', ['-X', 'utf8', 'scripts/lib/inspect-card-components.py'], {
    input: JSON.stringify({ id, svg: c.svg }),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  if (result.status !== 0) throw Error(id + ': ' + result.stderr);
}
console.log(JSON.stringify({ components: 52, suits: 4, pipLayouts: 9, aces: 4, courts: 12 }));
