import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import type {
  IdentityRequestMap,
  PrivateResponseMap,
  SessionResumeRequest,
  HandResult,
} from '@orbit/protocol';
import { createPokerServer } from '../../apps/server/src/create-server.js';
import { createSessionRuntime } from '../../apps/server/src/sessions/runtime.js';
import { persistenceContext, seedPersistenceGraph } from './persistence-context.js';
import { createHand, applyHandAction, createDeck } from '../../packages/poker-core/src/index.js';
export function request<K extends 'session:guest' | 'session:resume'>(
  socket: Socket,
  event: K,
  payload: IdentityRequestMap[K],
): Promise<PrivateResponseMap[K]> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(4000)
      .emit(event, payload, (error: Error | null, response: PrivateResponseMap[K]) =>
        error ? reject(error) : resolve(response),
      ),
  );
}
export function rawRequest(socket: Socket, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(4000)
      .emit(event, payload, (error: Error | null, response: unknown) =>
        error ? reject(error) : resolve(response),
      ),
  );
}
export function resumeRequest(
  resumeToken: string,
  extra: Partial<SessionResumeRequest> = {},
): SessionResumeRequest {
  return {
    requestId: randomUUID(),
    resumeToken,
    roomId: null,
    lastSeenHandId: null,
    lastSeenRoomVersion: null,
    lastSeenHandVersion: null,
    ...extra,
  };
}
export async function sessionContext() {
  const storage = persistenceContext(),
    clock = { now: 1000 },
    clients = new Set<Socket>();
  let runtime = createSessionRuntime({
      databasePath: storage.path,
      now: () => clock.now,
      serverEpoch: 'boot1',
    }),
    server = createPokerServer({ port: 0, sessions: runtime }),
    origin = (await server.listen()).origin,
    epoch = 1;
  async function connect(query: Record<string, string> = {}) {
    const socket = io(origin, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      query,
    });
    clients.add(socket);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      socket.once('connect_error', onError);
      socket.once('connect', () => {
        socket.off('connect_error', onError);
        resolve();
      });
    });
    return socket;
  }
  return {
    storage,
    clock,
    connect,
    get runtime() {
      return runtime;
    },
    get origin() {
      return origin;
    },
    async restart() {
      for (const socket of clients) socket.disconnect();
      clients.clear();
      await server.close();
      runtime.close();
      epoch++;
      runtime = createSessionRuntime({
        databasePath: storage.path,
        now: () => clock.now,
        serverEpoch: 'boot' + epoch,
      });
      server = createPokerServer({ port: 0, sessions: runtime });
      origin = (await server.listen()).origin;
    },
    async close() {
      for (const socket of clients) socket.disconnect();
      clients.clear();
      await server.close();
      runtime.close();
      storage.close();
    },
  };
}
export function seedOwnedCompletedHand(
  context: Awaited<ReturnType<typeof sessionContext>>,
  sessionId: string,
) {
  const row = context.storage.db.repositories.findSessionById(sessionId);
  if (!row) throw new Error('MISSING_SESSION');
  seedPersistenceGraph(context.storage, row, false);
  const initial = createHand({
    handId: 'h1',
    dealerSeatId: 0,
    deck: createDeck(),
    players: [
      { seatId: 0, participantId: 'p1', stack: 2000 },
      { seatId: 1, participantId: 'p2', stack: 2000 },
    ],
  }).state;
  const end = applyHandAction(initial, {
    seatId: 0,
    turnId: initial.turnId!,
    action: { type: 'fold' },
  });
  if (!end.ok || !end.state.result) throw new Error('HAND_NOT_SETTLED');
  const s = end.state,
    result = s.result!,
    id = (seat: number) => s.players.find((p) => p.seatId === seat)!.participantId;
  const wire: HandResult = {
    roomId: 'r1',
    matchId: 'm1',
    handId: 'h1',
    handVersion: s.handVersion,
    phase: 'settled',
    board: [...s.board],
    showdownCards: result.showdownCards.map((p) => ({
      participantId: id(p.seatId),
      cards: [p.cards[0], p.cards[1]],
    })),
    pots: result.settlement.plan.pots.map((p) => ({
      potId: p.potId,
      amount: p.amount,
      eligibleParticipantIds: p.eligibleSeatIds.map(id),
      winnerParticipantIds: p.winnerSeatIds.map(id),
      allocations: p.allocations.map((a) => ({ participantId: id(a.seatId), amount: a.amount })),
      winningCategory: p.winningCategory,
    })),
    refunds: result.refunds.map((r) => ({ participantId: id(r.seatId), amount: r.amount })),
    finalStacks: s.players.map((p) => ({
      participantId: p.participantId,
      seatId: p.seatId,
      stack: p.stack,
    })),
    reason: result.reason,
  };
  context.storage.raw
    .prepare('UPDATE hands SET status=?,result_json=?,ended_at=?,hand_version=? WHERE hand_id=?')
    .run('settled', JSON.stringify(wire), context.clock.now, s.handVersion, 'h1');
  context.storage.raw
    .prepare('UPDATE rooms SET status=?,closed_at=?')
    .run('closed', context.clock.now);
  context.storage.raw.prepare('UPDATE participants SET left_at=?').run(context.clock.now);
}
