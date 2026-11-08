import { RoomError, type RoomState } from '../rooms/room-types.js';
export interface ServerClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}
export interface TurnClock {
  handId: string;
  turnId: string;
  handVersion: number;
  actorParticipantId: string;
  startedAt: number;
  deadline: number;
}
export interface TimeoutToken extends TurnClock {
  roomId: string;
}
export function systemClock(now: () => number): ServerClock {
  return {
    now,
    setTimer(callback, delay) {
      const handle = setTimeout(callback, delay);
      handle.unref();
      return handle;
    },
    clearTimer(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}
export function withTurnClock(state: RoomState, now: number): RoomState {
  const hand = state.hand,
    actor = hand?.betting?.actorSeatId;
  if (state.row.status !== 'playing' || !hand?.turnId || actor === null || actor === undefined)
    return { ...state, turnClock: null };
  if (state.turnClock?.handId === hand.handId && state.turnClock.turnId === hand.turnId)
    return state;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + 30000))
    throw new RoomError('ROOM_PAUSED');
  const player = hand.players.find((p) => p.seatId === actor);
  if (!player) throw new RoomError('ROOM_PAUSED');
  return {
    ...state,
    turnClock: {
      handId: hand.handId,
      turnId: hand.turnId,
      handVersion: hand.handVersion,
      actorParticipantId: player.participantId,
      startedAt: now,
      deadline: now + 30000,
    },
  };
}
export class TurnTimer {
  private tasks = new Map<string, { token: TimeoutToken; handle: unknown }>();
  private closed = false;
  constructor(
    private clock: ServerClock,
    private due: (token: TimeoutToken) => Promise<unknown>,
    private fault: (roomId: string) => void,
  ) {}
  sync(state: RoomState) {
    if (this.closed) return;
    const id = state.row.roomId,
      token =
        state.row.status === 'playing' && state.turnClock
          ? { ...state.turnClock, roomId: id }
          : null,
      previous = this.tasks.get(id);
    if (
      previous &&
      token &&
      previous.token.handId === token.handId &&
      previous.token.turnId === token.turnId
    )
      return;
    this.cancel(id);
    if (token) this.arm(token);
  }
  private arm(token: TimeoutToken) {
    try {
      const now = this.clock.now();
      if (!Number.isSafeInteger(now) || now < 0) throw Error('CLOCK_INVALID');
      const handle = this.clock.setTimer(
        () => {
          try {
            if (this.closed || this.tasks.get(token.roomId)?.token !== token) return;
            this.tasks.delete(token.roomId);
            const now = this.clock.now();
            if (!Number.isSafeInteger(now) || now < 0) throw Error('CLOCK_INVALID');
            if (now < token.deadline) {
              this.arm(token);
              return;
            }
            void this.due(token).catch(() => this.fault(token.roomId));
          } catch {
            this.fault(token.roomId);
          }
        },
        Math.max(0, token.deadline - now),
      );
      this.tasks.set(token.roomId, { token, handle });
    } catch {
      this.fault(token.roomId);
    }
  }
  cancel(id: string) {
    const task = this.tasks.get(id);
    if (task) {
      this.tasks.delete(id);
      this.clock.clearTimer(task.handle);
    }
  }
  close() {
    this.closed = true;
    for (const id of this.tasks.keys()) this.cancel(id);
  }
}
