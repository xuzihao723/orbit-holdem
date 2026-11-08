import type { SessionResumed } from '@orbit/protocol';
import { publishResultTo } from './game/publish.js';
import { HistoryService } from './history/history-service.js';
import { ReservationBook } from './sessions/reservation-book.js';
import { ReservationExpiry } from './rooms/reservation-expiry.js';
import { BotScheduler } from './bots/scheduler.js';
import { WorkerPool, validateWorkerPoolOptions } from './bots/worker-pool.js';
import { liveResumeContext } from './sessions/live-resume-context.js';
import type { ResumeContextResolver } from './sessions/session-types.js';
import type { StartOptions } from './rooms/start-hand.js';
import { systemClock, type ServerClock } from './game/turn-timer.js';
import { randomUUID } from 'node:crypto';
import { openDatabase } from './persistence/db.js';
import type { PokerDatabase } from './persistence/rows.js';
import { createSessionRuntime } from './sessions/runtime.js';
import { CommandHandler } from './game/command-handler.js';
import type { Publication } from './rooms/room-types.js';
export type ApplicationOptions = StartOptions &
  (
    { databasePath: string; database?: never } | { database: PokerDatabase; databasePath?: never }
  ) & {
    now?: () => number;
    serverEpoch?: string;
    roomCode?: () => string;
    serverClock?: ServerClock;
    botOptions?: import('./bots/bot-types.js').BotOptions;
    workerPoolOptions?: import('./bots/worker-pool.js').WorkerPoolOptions;
  };
export function createApplicationRuntime(input: ApplicationOptions) {
  const owned = input.database === undefined,
    db = input.database ?? openDatabase({ path: input.databasePath!, busyTimeoutMs: 1000 });
  try {
    db.migrate();
    const workerOptions = validateWorkerPoolOptions(input.workerPoolOptions);
    let pool: WorkerPool | undefined;
    const getPool = () => {
      if (closing && !pool) throw Error('APPLICATION_CLOSED');
      return (pool ??= new WorkerPool(workerOptions));
    };
    let resolver: ResumeContextResolver | undefined;
    const now = input.serverClock ? () => input.serverClock!.now() : (input.now ?? Date.now),
      serverEpoch = input.serverEpoch ?? randomUUID(),
      reservations = new ReservationBook(now),
      archive = db.archivePreviousEpoch({ serverEpoch, now: now() }),
      sessions = createSessionRuntime({
        database: db,
        now,
        serverEpoch,
        canAccessSeat: (room, p) => reservations.allowed(room, p),
        contextResolver: {
          resolve: (input) => {
            if (!resolver) throw Error('RESUME_NOT_INITIALIZED');
            return resolver.resolve(input);
          },
          finalize: (input, result) => resolver?.finalize?.(input, result) ?? result,
        },
      }),
      listeners = new Set<(p: Publication) => void>();
    const emit = (p: Publication) => {
      for (const listener of listeners) {
        try {
          listener(p);
        } catch {
          /* Publication loss never undoes a commit. */
        }
      }
    };
    const rooms = new CommandHandler(
      db,
      sessions,
      emit,
      input.roomCode,
      {
        ...(input.handDeck ? { handDeck: input.handDeck } : {}),
        ...(input.randomInt ? { randomInt: input.randomInt } : {}),
      },
      input.serverClock ?? systemClock(now),
    );
    resolver = liveResumeContext(rooms, sessions, reservations, db.repositories);
    const bots = new BotScheduler(
      rooms,
      input.serverClock ?? systemClock(now),
      input.botOptions,
      getPool,
    );
    const expiry = new ReservationExpiry(
      input.serverClock ?? systemClock(now),
      reservations,
      (token, valid) => rooms.executeReservationExpiry(token, valid),
      (id) => rooms.pauseForFault(id),
    );
    const removeReservations = sessions.registry.onChange((sessionId, previous, current) => {
      if (!previous || current) return;
      for (const room of rooms.store.all())
        for (const p of room.participants)
          if (room.row.status !== 'closed' && p.sessionId === sessionId && p.leftAt === null)
            reservations.disconnect(
              room.row.roomId,
              p.participantId,
              previous.connectionGeneration,
            );
    });
    let closing: Promise<void> | undefined;
    return {
      sessions,
      history: new HistoryService(db, sessions),
      reservations,
      bots,
      get workerPool() {
        return getPool();
      },
      afterResume(socketId: string, response: SessionResumed) {
        if (response.outcome !== 'seatRestored') return;
        const control = sessions.registry.getBySocket(socketId),
          state = rooms.store.get(response.roomView.roomId);
        if (
          control &&
          control.sessionId === response.sessionId &&
          control.connectionGeneration === response.connectionGeneration &&
          state?.hand?.handId === response.roomView.currentHandId
        )
          publishResultTo(state, sessions, control, emit);
      },
      rooms,
      database: db,
      serverEpoch,
      onPublish(listener: (p: Publication) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close() {
        return (closing ??= (async () => {
          removeReservations();
          expiry.close();
          bots.close();
          await pool?.close();
          await rooms.close();
          reservations.clear();
          listeners.clear();
          sessions.close();
          if (owned) db.close();
        })());
      },
    };
  } catch (error) {
    if (owned) db.close();
    throw error;
  }
}
export type ApplicationRuntime = ReturnType<typeof createApplicationRuntime>;
