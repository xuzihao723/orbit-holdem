import { gameContext } from './game-context.js';
import { privacyScenario } from './privacy-scenarios.js';
export async function privacyContext() {
  const fixture = privacyScenario(),
    c = await gameContext({ players: 3, dealerSeatId: 2, deck: fixture.deck });
  try {
    for (const type of ['call', 'call', 'check', 'check', 'fold'] as const) {
      const ack = await c.play({ type });
      if (!ack.ok) throw Error(ack.code);
    }
    return { ...c, fixture };
  } catch (e) {
    await c.close();
    throw e;
  }
}
