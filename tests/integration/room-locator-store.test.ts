import { expect, it } from 'vitest';
import {
  memoryRoomLocatorStore,
  browserRoomLocatorStore,
  type RoomLocator,
} from '../../apps/web/src/network/room-locator-store.js';
const sample: RoomLocator = {
  sessionId: 's',
  roomId: 'r',
  roomCode: 'ABC234',
  lastSeenHandId: 'h',
  lastSeenRoomVersion: 2,
  lastSeenHandVersion: 1,
};
it('retains only a copied location and versions, without mutable references', () => {
  const store = memoryRoomLocatorStore(),
    value = { ...sample };
  store.write(value);
  value.roomCode = 'BAD';
  expect(store.read()).toEqual(sample);
  const read = store.read()!;
  read.roomId = 'mutated';
  expect(store.read()?.roomId).toBe('r');
  store.clear();
  expect(store.read()).toBeNull();
});
it('rejects credentials, unsafe versions and malformed stored JSON', () => {
  let text: string | null = null;
  const storage: Storage = {
      length: 0,
      key: () => null,
      clear: () => {
        text = null;
      },
      getItem: () => text,
      setItem: (_k: string, v: string) => {
        text = v;
      },
      removeItem: () => {
        text = null;
      },
    },
    store = browserRoomLocatorStore(storage);
  store.write(sample);
  expect(store.read()).toEqual(sample);
  text = JSON.stringify({ ...sample, resumeToken: 'secret' });
  expect(store.read()).toBeNull();
  text = JSON.stringify({ ...sample, lastSeenHandVersion: -1 });
  expect(store.read()).toBeNull();
  text = '[';
  expect(store.read()).toBeNull();
});
