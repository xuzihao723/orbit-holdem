import { timerContext } from './timer-context.js';
import { request, resumeRequest } from './session-context.js';
export async function waitUntil(predicate: () => boolean) {
  const end = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('CONDITION_TIMEOUT');
    await new Promise((r) => setTimeout(r, 5));
  }
}
export async function reconnectContext() {
  const c = await timerContext(),
    owner = c.humans[0]!,
    ownerParticipantId = c.hand().players[0]!.participantId;
  return {
    ...c,
    owner,
    ownerParticipantId,
    async disconnectOwner() {
      owner.socket.disconnect();
      await waitUntil(() => c.app.sessions.registry.getCurrent(owner.sessionId) === null);
      await c.app.rooms.queue.idle();
    },
    async resumeOwner() {
      const next = await c.guest('Replacement');
      const response = await request(
        next.socket,
        'session:resume',
        resumeRequest(owner.resumeToken, { roomId: c.roomId, lastSeenHandId: c.hand().handId }),
      );
      return { socket: next.socket, response };
    },
  };
}
