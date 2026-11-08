import type { CommandAck } from '@orbit/protocol';
import type { AuthenticatedCommand } from '../../apps/server/src/transport/types.js';
import type { CommandHandler } from '../../apps/server/src/game/command-handler.js';
function handler(value: CommandHandler, command: AuthenticatedCommand): Promise<CommandAck> {
  return value.execute(command);
}
void handler;
