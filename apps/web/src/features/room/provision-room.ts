import type { RoomView, CommandAck } from '@orbit/protocol';
import type { createSocketClient } from '../../network/socket-client';
import type { ViewSnapshot } from '../../network/view-store';
import { ROOM_CODE } from '../../app/router';
import type { EntryConfig, EntryIntent, EntryStep, EntryIntentStore } from './entry-intent-store';
export function validateEntryConfig(c: EntryConfig): EntryConfig {
  if (/\p{Cc}/u.test(c.nickname)) throw Error('NICKNAME_INVALID');
  const nickname = c.nickname.trim(),
    length = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(nickname)].length;
  if (length < 1 || length > 12) throw Error('NICKNAME_INVALID');
  const roomCode = c.roomCode.trim().toUpperCase();
  if (
    !['solo', 'create', 'join'].includes(c.mode) ||
    ![2, 3, 4].includes(c.capacity) ||
    !['basic', 'standard'].includes(c.difficulty) ||
    !Number.isInteger(c.botCount) ||
    c.botCount < 0 ||
    c.botCount > 3 ||
    (c.mode === 'solo' && (c.botCount < 1 || c.capacity !== c.botCount + 1))
  )
    throw Error('ENTRY_CONFIG_INVALID');
  if (c.mode === 'join' && !ROOM_CODE.test(roomCode)) throw Error('ROOM_CODE_INVALID');
  return { ...c, nickname, roomCode };
}
export function identifySelf(room: RoomView, auth: ViewSnapshot['authContext']) {
  if (auth?.roomId !== room.roomId || !auth.participantId) return null;
  return room.seats.find((s) => s.occupant?.participantId === auth.participantId)?.occupant ?? null;
}
type Client = ReturnType<typeof createSocketClient>;
export async function ensureEntryIdentity(client: Client, nickname: string) {
  await client.loadAccount();
  await client.connect();
  if (!client.identitySessionId) {
    const r = await client.guest(nickname);
    if (!r.ok) throw Error(r.code);
  } else if (!client.store.snapshot.controlReady) {
    const r = await client.resume();
    if (!r.ok) throw Error(r.code);
  }
  if (!client.store.snapshot.controlReady) throw Error('CONTROL_UNAVAILABLE');
}
export async function beginEntry(client: Client, journal: EntryIntentStore, raw: EntryConfig) {
  const config = validateEntryConfig(raw);
  await ensureEntryIdentity(client, config.nickname);
  const sessionId = client.store.snapshot.authContext?.sessionId;
  if (!sessionId) throw Error('NO_IDENTITY');
  const prior = journal.read();
  if (prior && prior.sessionId === sessionId && prior.status !== 'complete')
    throw Error('ENTRY_CONTINUE_REQUIRED');
  const intent: EntryIntent = {
    version: 1,
    id: crypto.randomUUID(),
    sessionId,
    config,
    steps: [],
    roomId: null,
    roomCode: null,
    status: 'pending',
  };
  journal.write(intent);
  return intent;
}
export async function provisionRoom(
  client: Client,
  journal: EntryIntentStore,
  original: EntryIntent,
): Promise<RoomView> {
  const intent = structuredClone(original);
  validateEntryConfig(intent.config);
  const current = () => {
    if (
      client.identitySessionId !== intent.sessionId ||
      client.store.snapshot.authContext?.sessionId !== intent.sessionId
    )
      throw Error('ENTRY_IDENTITY_CHANGED');
    if (!client.store.snapshot.controlReady) throw Error('CONTROL_UNAVAILABLE');
  };
  const save = () => journal.write(intent);
  const refresh = async () => {
    current();
    if (intent.roomId) client.store.selectRoom(intent.roomId);
    const response = await client.resume();
    if (!response.ok) throw Error(response.code);
    if (
      response.outcome !== 'seatRestored' ||
      (intent.roomId && response.roomView.roomId !== intent.roomId)
    )
      throw Error('SELF_RESTORE_REQUIRED');
    intent.roomId = response.roomView.roomId;
    intent.roomCode = response.roomView.roomCode;
    save();
    return response.roomView;
  };
  async function step(
    phase: string,
    event: EntryStep['event'],
    payload: Omit<EntryStep['payload'], 'commandId'>,
  ) {
    current();
    let item = [...intent.steps]
      .reverse()
      .find((s) => s.phase === phase && s.status !== 'superseded');
    if (item?.status === 'confirmed') return null;
    if (item?.status === 'failed') {
      if (item.failure !== 'STALE_STATE') throw Error(item.failure ?? 'ENTRY_FAILED');
      item.status = 'superseded';
      item = undefined;
    }
    if (!item) {
      if (intent.steps.length >= 32) throw Error('ENTRY_ATTEMPT_LIMIT');
      item = {
        phase,
        event,
        payload: { ...payload, commandId: crypto.randomUUID() } as EntryStep['payload'],
        status: 'pending',
        failure: null,
      };
      intent.steps.push(item);
    }
    save();
    let ack: CommandAck;
    try {
      ack = await client.sendCommand(item.event, item.payload as never);
    } catch (error) {
      item.status = 'uncertain';
      intent.status = 'uncertain';
      save();
      throw error;
    }
    if (!ack.ok) {
      item.status = 'failed';
      item.failure = ack.code;
      intent.status = 'failed';
      save();
      throw Error(ack.code);
    }
    item.status = 'confirmed';
    item.failure = null;
    intent.status = 'pending';
    intent.roomId = ack.roomId;
    save();
    return ack;
  }
  current();
  const c = intent.config;
  if (!intent.steps.some((s) => s.phase === 'entry' && s.status === 'confirmed'))
    await step(
      'entry',
      c.mode === 'join' ? 'room:join' : 'room:create',
      c.mode === 'join'
        ? { nickname: c.nickname, roomCode: c.roomCode }
        : { nickname: c.nickname, capacity: c.capacity },
    );
  let room = await refresh();
  if (c.mode === 'solo')
    for (let i = 0; i < c.botCount; i++) {
      const phase = 'bot:' + i,
        prior = [...intent.steps]
          .reverse()
          .find((s) => s.phase === phase && s.status !== 'superseded');
      if (prior?.status === 'confirmed') continue;
      const seat = room.seats.find((s) => s.availability === 'open');
      // An uncertain command may already occupy its seat; retry its original payload first.
      if (!seat && (!prior || prior.status === 'failed')) throw Error('ROOM_FULL');
      await step(phase, 'room:bot:add', {
        roomId: room.roomId,
        expectedRoomVersion: room.roomVersion,
        seatId: seat?.seatId ?? 0,
        difficulty: c.difficulty,
      });
      room = await refresh();
    }
  if (
    c.mode === 'solo' &&
    (room.seats.filter((s) => s.occupant?.kind === 'bot' && s.occupant.difficulty === c.difficulty)
      .length !== c.botCount ||
      room.seats.filter((s) => s.occupant?.kind === 'human').length !== 1 ||
      room.capacity !== c.capacity)
  ) {
    intent.status = 'failed';
    save();
    throw Error('ENTRY_ROSTER_CHANGED');
  }
  intent.status = 'complete';
  save();
  return room;
}
