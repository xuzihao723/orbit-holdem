import { expect, it } from 'vitest';
it('invalidates an old controlled page when shared storage switches to another guest identity', async () => {
  const c = await roomContext(),
    credentials = memoryCredentialStore(),
    a = createSocketClient({ url: c.origin, credentials }),
    b = createSocketClient({ url: c.origin, credentials }),
    t = createSocketClient({ url: c.origin, credentials }),
    journal = memoryEntryIntentStore();
  try {
    const i = await beginEntry(a, journal, { ...config, mode: 'create', botCount: 0 }),
      room = await provisionRoom(a, journal, i);
    await b.connect();
    await b.resume();
    await t.connect();
    await t.guest('新身份');
    await expect(
      b.sendCommand('room:ready', {
        commandId: crypto.randomUUID(),
        roomId: room.roomId,
        expectedRoomVersion: b.store.snapshot.roomView!.roomVersion,
        ready: true,
      }),
    ).rejects.toThrow('ENTRY_IDENTITY_CHANGED');
    await expect(async () => b.resume()).rejects.toThrow('ENTRY_IDENTITY_CHANGED');
    expect(b.store.snapshot.controlReady).toBe(false);
    expect(c.readRoom(room.roomId).participants.find((p) => p.sessionId !== null)!.ready).toBe(
      false,
    );
    expect(t.store.snapshot.controlReady).toBe(true);
    expect(t.store.snapshot.status).toBe('ready');
  } finally {
    a.close();
    b.close();
    t.close();
    await c.close();
  }
});
it('replaces a deterministically stale bot step with a new UUID while preserving its original payload', async () => {
  const c = await roomContext(),
    client = createSocketClient({ url: c.origin }),
    journal = memoryEntryIntentStore();
  let changed = false;
  try {
    const i = await beginEntry(client, journal, config),
      wrapped = {
        ...client,
        sendCommand: async (...args: Parameters<typeof client.sendCommand>) => {
          if (args[0] === 'room:bot:add' && !changed) {
            changed = true;
            const r = client.store.snapshot.roomView!;
            await client.sendCommand('room:ready', {
              commandId: crypto.randomUUID(),
              roomId: r.roomId,
              expectedRoomVersion: r.roomVersion,
              ready: true,
            });
          }
          return client.sendCommand(...args);
        },
      } as typeof client;
    await expect(provisionRoom(wrapped, journal, i)).rejects.toThrow('STALE_STATE');
    const old = journal.read()!.steps.find((s) => s.phase === 'bot:0')!,
      payload = structuredClone(old.payload);
    await provisionRoom(client, journal, journal.read()!);
    const attempts = journal.read()!.steps.filter((s) => s.phase === 'bot:0');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.payload).toEqual(payload);
    expect(attempts[0]!.status).toBe('superseded');
    expect(attempts[1]!.payload.commandId).not.toBe(old.payload.commandId);
  } finally {
    client.close();
    await c.close();
  }
});
import { roomContext } from '../helpers/room-context.js';
import { createSocketClient } from '../../apps/web/src/network/socket-client.js';
import { memoryCredentialStore } from '../../apps/web/src/network/credential-store.js';
import { memoryRoomLocatorStore } from '../../apps/web/src/network/room-locator-store.js';
import {
  memoryEntryIntentStore,
  browserEntryIntentStore,
} from '../../apps/web/src/features/room/entry-intent-store.js';
import {
  beginEntry,
  provisionRoom,
  identifySelf,
  validateEntryConfig,
} from '../../apps/web/src/features/room/provision-room.js';
it('accepts a ZWJ emoji nickname as one server-compatible grapheme', () => {
  expect(validateEntryConfig({ ...config, nickname: '👨‍👩‍👧‍👦' }).nickname).toBe('👨‍👩‍👧‍👦');
});
it('does not mark an altered partial roster complete', async () => {
  const c = await roomContext(),
    client = createSocketClient({ url: c.origin }),
    journal = memoryEntryIntentStore();
  let adds = 0;
  try {
    const i = await beginEntry(client, journal, config),
      wrapped = {
        ...client,
        sendCommand: async (...args: Parameters<typeof client.sendCommand>) => {
          const r = await client.sendCommand(...args);
          if (args[0] === 'room:bot:add' && ++adds === 2) throw Error('ACK_UNCERTAIN');
          return r;
        },
      } as typeof client;
    await expect(provisionRoom(wrapped, journal, i)).rejects.toThrow('ACK_UNCERTAIN');
    await client.resume();
    const r = client.store.snapshot.roomView!,
      first = r.seats.find((s) => s.occupant?.kind === 'bot')!;
    await client.sendCommand('room:bot:remove', {
      commandId: crypto.randomUUID(),
      roomId: r.roomId,
      expectedRoomVersion: r.roomVersion,
      seatId: first.seatId,
    });
    await expect(provisionRoom(client, journal, journal.read()!)).rejects.toThrow(
      'ENTRY_ROSTER_CHANGED',
    );
    expect(journal.read()!.status).not.toBe('complete');
  } finally {
    client.close();
    await c.close();
  }
});
const config = {
  mode: 'solo' as const,
  nickname: '小林',
  capacity: 4 as const,
  botCount: 3 as const,
  difficulty: 'standard' as const,
  roomCode: '',
};
it('round-trips a valid nickname containing deck and refuses private or malformed journal fields', () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    } as Storage,
    journal = browserEntryIntentStore(storage);
  const i = {
    version: 1 as const,
    id: crypto.randomUUID(),
    sessionId: 'session',
    config: { ...config, nickname: 'deck' },
    steps: [],
    roomId: null,
    roomCode: null,
    status: 'pending' as const,
  };
  journal.write(i);
  expect(journal.read()).toEqual(i);
  storage.setItem(
    'orbit.entry-intent.v1',
    JSON.stringify({ ...i, config: { ...i.config, resumeToken: 'secret' } }),
  );
  expect(journal.read()).toBeNull();
  storage.setItem(
    'orbit.entry-intent.v1',
    JSON.stringify({ ...i, config: { ...i.config, capacity: 99 } }),
  );
  expect(journal.read()).toBeNull();
});
it('creates a real room with three standard bots serially and gets self from private resume', async () => {
  const c = await roomContext(),
    client = createSocketClient({ url: c.origin }),
    journal = memoryEntryIntentStore();
  try {
    const intent = await beginEntry(client, journal, config);
    const room = await provisionRoom(client, journal, intent);
    expect(room.seats.filter((s) => s.occupant?.kind === 'bot')).toHaveLength(3);
    expect(client.store.snapshot.playerView).toBeNull();
    expect(identifySelf(room, client.store.snapshot.authContext)?.nickname).toBe('小林');
    expect(journal.read()!.status).toBe('complete');
  } finally {
    client.close();
    await c.close();
  }
});
it('resumes an uncertain create with the original UUID after a fresh client and never creates a second room', async () => {
  const c = await roomContext(),
    credentials = memoryCredentialStore(),
    locator = memoryRoomLocatorStore(),
    journal = memoryEntryIntentStore();
  let client = createSocketClient({ url: c.origin, credentials, locator });
  try {
    const intent = await beginEntry(client, journal, { ...config, mode: 'create', botCount: 0 });
    const wrapped = {
      ...client,
      sendCommand: async (...args: Parameters<typeof client.sendCommand>) => {
        await client.sendCommand(...args);
        throw Error('ACK_UNCERTAIN');
      },
    } as typeof client;
    await expect(provisionRoom(wrapped, journal, intent)).rejects.toThrow('ACK_UNCERTAIN');
    const id = journal.read()!.steps[0]!.payload.commandId;
    client.close();
    client = createSocketClient({ url: c.origin, credentials, locator });
    await client.connect();
    await client.resume();
    const room = await provisionRoom(client, journal, journal.read()!);
    expect(journal.read()!.steps[0]!.payload.commandId).toBe(id);
    expect(c.app.rooms.store.all()).toHaveLength(1);
    expect(room.roomId).toBe(c.app.rooms.store.all()[0]!.row.roomId);
  } finally {
    client.close();
    await c.close();
  }
});
it('preserves a partially provisioned room and reuses the uncertain bot command after recovery', async () => {
  const c = await roomContext(),
    client = createSocketClient({ url: c.origin }),
    journal = memoryEntryIntentStore();
  let adds = 0;
  try {
    const intent = await beginEntry(client, journal, config),
      wrapped = {
        ...client,
        sendCommand: async (...args: Parameters<typeof client.sendCommand>) => {
          const r = await client.sendCommand(...args);
          if (args[0] === 'room:bot:add' && ++adds === 2) throw Error('ACK_UNCERTAIN');
          return r;
        },
      } as typeof client;
    await expect(provisionRoom(wrapped, journal, intent)).rejects.toThrow('ACK_UNCERTAIN');
    expect(c.app.rooms.store.all()[0]!.participants.filter((p) => p.botId)).toHaveLength(2);
    const room = await provisionRoom(client, journal, journal.read()!);
    expect(room.seats.filter((s) => s.occupant?.kind === 'bot')).toHaveLength(3);
    expect(c.app.rooms.store.all()).toHaveLength(1);
  } finally {
    client.close();
    await c.close();
  }
});
it('does not identify a same-named host as the joining self or continue another identity intent', async () => {
  const c = await roomContext(),
    a = createSocketClient({ url: c.origin }),
    b = createSocketClient({ url: c.origin }),
    ja = memoryEntryIntentStore(),
    jb = memoryEntryIntentStore();
  try {
    const ia = await beginEntry(a, ja, { ...config, mode: 'create', botCount: 0 }),
      room = await provisionRoom(a, ja, ia),
      ib = await beginEntry(b, jb, {
        ...config,
        mode: 'join',
        botCount: 0,
        roomCode: room.roomCode,
      }),
      joined = await provisionRoom(b, jb, ib);
    expect(identifySelf(joined, b.store.snapshot.authContext)?.participantId).not.toBe(
      room.hostParticipantId,
    );
    expect(identifySelf(joined, b.store.snapshot.authContext)?.participantId).toBe(
      b.store.snapshot.authContext?.participantId,
    );
    await expect(provisionRoom(b, ja, ia)).rejects.toThrow('ENTRY_IDENTITY_CHANGED');
  } finally {
    a.close();
    b.close();
    await c.close();
  }
});
it.each(['', '             ', 'a\nname', '十三个字数测试甲乙丙丁戊己庚'])(
  'rejects invalid nickname %j',
  (nickname) => expect(() => validateEntryConfig({ ...config, nickname })).toThrow(),
);
