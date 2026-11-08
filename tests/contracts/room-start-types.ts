import type { HandPublicState, HandResult } from '@orbit/protocol';
import { projectPublicHand } from '../../apps/server/src/game/public-hand-view.js';
import { projectHandResult } from '../../apps/server/src/game/hand-result.js';
function types(...args: Parameters<typeof projectPublicHand>): HandPublicState | null {
  return projectPublicHand(...args);
}
function result(...args: Parameters<typeof projectHandResult>): HandResult {
  return projectHandResult(...args);
}
void types;
void result;
