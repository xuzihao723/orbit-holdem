export interface RoomLocator {
  sessionId: string;
  roomId: string;
  roomCode: string;
  lastSeenHandId: string | null;
  lastSeenRoomVersion: number | null;
  lastSeenHandVersion: number | null;
}
export interface RoomLocatorStore {
  read(): RoomLocator | null;
  write(value: RoomLocator): void;
  clear(): void;
}
function parse(value: unknown): RoomLocator | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>,
    keys = [
      'sessionId',
      'roomId',
      'roomCode',
      'lastSeenHandId',
      'lastSeenRoomVersion',
      'lastSeenHandVersion',
    ];
  if (
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k) || !('value' in Object.getOwnPropertyDescriptor(v, k)!))
  )
    return null;
  if (
    ['sessionId', 'roomId', 'roomCode'].some(
      (k) => typeof v[k] !== 'string' || !v[k] || String(v[k]).length > 512,
    )
  )
    return null;
  if (v.lastSeenHandId !== null && (typeof v.lastSeenHandId !== 'string' || !v.lastSeenHandId))
    return null;
  if (
    ['lastSeenRoomVersion', 'lastSeenHandVersion'].some(
      (k) => v[k] !== null && (!Number.isSafeInteger(v[k]) || Number(v[k]) < 0),
    )
  )
    return null;
  return { ...v } as unknown as RoomLocator;
}
export function memoryRoomLocatorStore(): RoomLocatorStore {
  let current: RoomLocator | null = null;
  return {
    read: () => (current ? { ...current } : null),
    write(value) {
      const v = parse(value);
      if (!v) throw Error('INVALID_ROOM_LOCATOR');
      current = v;
    },
    clear() {
      current = null;
    },
  };
}
export function browserRoomLocatorStore(
  storage: Storage = localStorage,
  key = 'orbit.last-room',
): RoomLocatorStore {
  return {
    read() {
      try {
        return parse(JSON.parse(storage.getItem(key) ?? 'null'));
      } catch {
        return null;
      }
    },
    write(value) {
      const v = parse(value);
      if (!v) throw Error('INVALID_ROOM_LOCATOR');
      storage.setItem(key, JSON.stringify(v));
    },
    clear() {
      storage.removeItem(key);
    },
  };
}
