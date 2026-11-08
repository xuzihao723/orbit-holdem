import { gameContext } from './game-context.js';
import { FakeClock } from './fake-clock.js';
export async function timerContext(input: Parameters<typeof gameContext>[0] = {}) {
  const clock = new FakeClock(),
    c = await gameContext({ ...input, serverClock: clock });
  clock.flush = () => c.app.rooms.queue.idle();
  return {
    ...c,
    clock,
    deadline: () => c.readRoom(c.roomId).turnClock?.deadline ?? null,
    token: () => ({ ...c.readRoom(c.roomId).turnClock!, roomId: c.roomId }),
    events: (kind: string) =>
      c.storage.raw
        .prepare('SELECT payload_json FROM hand_events WHERE kind=? ORDER BY sequence')
        .all(kind)
        .map((v) => JSON.parse(String(v.payload_json)) as Record<string, unknown>),
    internalReceiptCount: () =>
      c.storage.raw
        .prepare("SELECT COUNT(*) n FROM command_receipts WHERE event='internal:timeout'")
        .get()?.n,
  };
}
