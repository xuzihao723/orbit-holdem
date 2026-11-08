import type { RoomState } from './room-types.js';
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
export class RoomStore {
  #rooms = new Map<string, RoomState>();
  get(id: string) {
    return this.#rooms.get(id) ?? null;
  }
  findCode(code: string) {
    return (
      [...this.#rooms.values()].find((s) => s.row.roomCode === code && s.row.status !== 'closed') ??
      null
    );
  }
  all() {
    return [...this.#rooms.values()];
  }
  replace(state: RoomState) {
    this.#rooms.set(state.row.roomId, freeze(state));
  }
  clear() {
    this.#rooms.clear();
  }
}
