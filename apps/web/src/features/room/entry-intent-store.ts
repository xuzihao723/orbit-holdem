import { validateEntryConfig } from './provision-room';
import type {
  MutatingCommandMap,
  MutatingEventName,
  Capacity,
  BotDifficulty,
} from '@orbit/protocol';
export interface EntryConfig {
  mode: 'solo' | 'create' | 'join';
  nickname: string;
  capacity: Capacity;
  botCount: number;
  difficulty: BotDifficulty;
  roomCode: string;
}
export type EntryStep = {
  phase: string;
  event: 'room:create' | 'room:join' | 'room:bot:add';
  payload: MutatingCommandMap['room:create' | 'room:join' | 'room:bot:add'];
  status: 'pending' | 'uncertain' | 'confirmed' | 'failed' | 'superseded';
  failure: string | null;
};
export interface EntryIntent {
  version: 1;
  id: string;
  sessionId: string;
  config: EntryConfig;
  steps: EntryStep[];
  roomId: string | null;
  roomCode: string | null;
  status: 'pending' | 'uncertain' | 'failed' | 'complete';
}
export interface EntryIntentStore {
  read(): EntryIntent | null;
  write(i: EntryIntent): void;
  clear(): void;
}
export function memoryEntryIntentStore(): EntryIntentStore {
  let v: EntryIntent | null = null;
  return {
    read: () => (v ? structuredClone(v) : null),
    write: (i) => {
      v = structuredClone(i);
    },
    clear: () => {
      v = null;
    },
  };
}
function decode(raw: string | null): EntryIntent | null {
  try {
    const v = JSON.parse(raw ?? 'null') as EntryIntent;
    if (
      !v ||
      v.version !== 1 ||
      typeof v.id !== 'string' ||
      typeof v.sessionId !== 'string' ||
      !v.config ||
      !Array.isArray(v.steps) ||
      v.steps.length > 32 ||
      !['pending', 'uncertain', 'failed', 'complete'].includes(v.status)
    )
      return null;
    if (
      Object.keys(v.config).sort().join(',') !==
      'botCount,capacity,difficulty,mode,nickname,roomCode'
    )
      return null;
    validateEntryConfig(v.config);
    if (
      (v.roomId !== null && typeof v.roomId !== 'string') ||
      (v.roomCode !== null && typeof v.roomCode !== 'string')
    )
      return null;
    for (const step of v.steps) {
      if (!step || Object.keys(step).sort().join(',') !== 'event,failure,payload,phase,status')
        return null;
      const keys = Object.keys(step.payload ?? {})
        .sort()
        .join(',');
      if (step.event === 'room:create' && keys !== 'capacity,commandId,nickname') return null;
      if (step.event === 'room:join' && keys !== 'commandId,nickname,roomCode') return null;
      if (
        step.event === 'room:bot:add' &&
        keys !== 'commandId,difficulty,expectedRoomVersion,roomId,seatId'
      )
        return null;
    }

    if (
      Object.keys(v).sort().join(',') !== 'config,id,roomCode,roomId,sessionId,status,steps,version'
    )
      return null;
    if (
      v.steps.some(
        (s) =>
          !s ||
          !['room:create', 'room:join', 'room:bot:add'].includes(s.event) ||
          typeof s.payload?.commandId !== 'string' ||
          typeof s.phase !== 'string' ||
          !['pending', 'uncertain', 'confirmed', 'failed', 'superseded'].includes(s.status),
      )
    )
      return null;
    return v;
  } catch {
    return null;
  }
}
export function browserEntryIntentStore(
  storage: Storage = localStorage,
  accountId: () => string | null = () => null,
): EntryIntentStore {
  const key = 'orbit.entry-intent.v1';
  const accountKey = (id: string) => `${key}.${id}`;
  const readLegacy = () => decode(storage.getItem(key));
  return {
    read() {
      const id = accountId();
      const legacy = readLegacy();
      return id
        ? (decode(storage.getItem(accountKey(id))) ?? (legacy?.sessionId === id ? legacy : null))
        : legacy;
    },
    write: (i) => {
      const id = accountId();
      storage.setItem(id ? accountKey(id) : key, JSON.stringify(i));
    },
    clear() {
      const id = accountId();
      if (id) storage.removeItem(accountKey(id));
      if (!id || readLegacy()?.sessionId === id) storage.removeItem(key);
    },
  };
}
