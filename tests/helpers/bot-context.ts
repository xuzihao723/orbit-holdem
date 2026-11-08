import { lifecycleContext } from './lifecycle-context.js';
import { projectBotObservation } from '../../apps/server/src/bots/observation.js';
export async function botContext(
  botOptions?: import('../../apps/server/src/bots/bot-types.js').BotOptions,
) {
  const c = await lifecycleContext({ players: 1, bots: 1, ...(botOptions ? { botOptions } : {}) });
  try {
    await c.start();
    const h = c.room().hand!,
      ack = await c.command(c.humans[0]!.socket, 'game:action', {
        commandId: crypto.randomUUID(),
        roomId: c.roomId,
        handId: h.handId,
        turnId: h.turnId!,
        expectedVersion: h.handVersion,
        action: { type: 'call' },
      });
    if (!ack.ok) throw Error(ack.code);
    const bot = c.room().participants.find((p) => p.botId !== null)!;
    return { ...c, bot, observation: () => projectBotObservation(c.room(), bot.botId!)! };
  } catch (e) {
    await c.close();
    throw e;
  }
}
