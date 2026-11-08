import type { JoinRoomCommand, GameActionCommand, HistoryListRequest } from '@orbit/protocol';
import { parseMutating } from '../../apps/server/src/transport/command-payloads.js';
import { parseQuery } from '../../apps/server/src/transport/query-payloads.js';
function typed(raw: unknown) {
  const join: JoinRoomCommand = parseMutating('room:join', raw);
  const action: GameActionCommand = parseMutating('game:action', raw);
  const history: HistoryListRequest = parseQuery('history:list', raw);
  return { join, action, history };
}
void typed;
