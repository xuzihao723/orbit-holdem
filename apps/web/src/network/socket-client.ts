import { io } from 'socket.io-client';
import type { createAccountState } from './account-client';
import type {
  GuestResponse,
  ResumeResponse,
  CommandAck,
  MutatingEventName,
  MutatingCommandMap,
  HistoryResponse,
  ReplayResponse,
  QueryRequestMap,
} from '@orbit/protocol';
import { ViewStore } from './view-store.js';
import {
  memoryCredentialStore,
  browserCredentialStore,
  type CredentialStore,
} from './credential-store.js';
import {
  readAck,
  readGuest,
  readResume,
  readRoom,
  readPlayer,
  readResult,
  readHistory,
  readReplay,
} from './wire-validate.js';
import {
  memoryRoomLocatorStore,
  browserRoomLocatorStore,
  type RoomLocatorStore,
} from './room-locator-store.js';
export interface SocketClientOptions {
  url?: string;
  credentials?: CredentialStore;
  store?: ViewStore;
  timeoutMs?: number;
  locator?: RoomLocatorStore;
  account?: ReturnType<typeof createAccountState>;
}
export function createSocketClient(options: SocketClientOptions = {}) {
  const store = options.store ?? new ViewStore(),
    credentials =
      options.credentials ??
      (typeof localStorage === 'undefined' ? memoryCredentialStore() : browserCredentialStore()),
    timeout = options.timeoutMs ?? 4000,
    locator =
      options.locator ??
      (typeof localStorage === 'undefined' ? memoryRoomLocatorStore() : browserRoomLocatorStore());
  const socket = io(options.url, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  let connection = 0,
    closed = false,
    syncing = false;
  let manualDisconnect = false,
    identityPending = 0;
  let pendingIdentityRequest: string | null = null;
  const identityFrames: {
    event: 'room:view' | 'game:view' | 'game:result';
    value: NonNullable<
      ReturnType<typeof readRoom> | ReturnType<typeof readPlayer> | ReturnType<typeof readResult>
    >;
    connection: number;
  }[] = [];
  const accountId = () => options.account?.snapshot().sessionId ?? null;
  const identitySessionId = () => accountId() ?? credentials.read()?.sessionId ?? null;
  const remember = () => {
    const room = store.snapshot.roomView,
      sessionId = identitySessionId(),
      player = store.snapshot.playerView,
      previous = locator.read();
    if (!room || !sessionId || !store.snapshot.controlReady) return;
    try {
      locator.write({
        sessionId,
        roomId: room.roomId,
        roomCode: room.roomCode,
        lastSeenHandId: room.currentHandId,
        lastSeenRoomVersion: room.roomVersion,
        lastSeenHandVersion:
          player?.handId === room.currentHandId
            ? player.handVersion
            : previous?.roomId === room.roomId && previous.lastSeenHandId === room.currentHandId
              ? previous.lastSeenHandVersion
              : null,
      });
    } catch {
      /* Storage failure does not change server control. */
    }
  };
  const removeRemember = store.subscribe(remember);
  const waiters = new Map<
    string,
    Set<{
      resolve: (ack: CommandAck) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }>
  >();
  const connecting = new Set<() => void>();
  const queryCancelers = new Set<() => void>();
  function cancelConnecting() {
    for (const cancel of connecting) cancel();
    connecting.clear();
  }
  function credentialsChanged() {
    const bound = store.snapshot.authContext?.sessionId;
    return !!bound && identitySessionId() !== bound;
  }
  function invalidateCredentials() {
    if (!credentialsChanged()) return;
    manualDisconnect = true;
    cancelConnecting();
    socket.disconnect();
    store.disconnect();
    cancel();
  }
  function assertCredentialIdentity() {
    if (credentialsChanged()) {
      invalidateCredentials();
      throw Error('ENTRY_IDENTITY_CHANGED');
    }
  }
  function cancel() {
    for (const cancel of [...queryCancelers]) cancel();
    for (const group of waiters.values())
      for (const w of group) {
        clearTimeout(w.timer);
        w.reject(Error('CONTROL_UNAVAILABLE'));
      }
    waiters.clear();
  }
  socket.on('connect', () => {
    connection = store.beginConnection();
  });
  socket.on('disconnect', () => {
    cancelConnecting();
    identityFrames.length = 0;
    pendingIdentityRequest = null;
    store.disconnect();
    cancel();
  });
  function sync() {
    if (
      !store.snapshot.syncNeeded ||
      syncing ||
      identityPending > 0 ||
      !socket.connected ||
      store.snapshot.status === 'takenOver' ||
      store.snapshot.status === 'expired' ||
      !identitySessionId()
    )
      return;
    syncing = true;
    void resume()
      .catch(() => {})
      .finally(() => {
        syncing = false;
      });
  }
  function applyView(event: 'room:view' | 'game:view' | 'game:result', value: unknown) {
    if (event === 'room:view') store.receiveRoom(value);
    else if (event === 'game:view') store.receivePlayer(value);
    else store.receiveResult(value);
  }
  function receiveView(event: 'room:view' | 'game:view' | 'game:result', raw: unknown) {
    if (pendingIdentityRequest) {
      const value =
        event === 'room:view'
          ? readRoom(raw)
          : event === 'game:view'
            ? readPlayer(raw)
            : readResult(raw);
      if (value) {
        identityFrames.push({ event, value, connection });
        while (identityFrames.length > 12) identityFrames.shift();
      }
      return;
    }
    applyView(event, raw);
    sync();
  }
  socket.on('room:view', (v: unknown) => receiveView('room:view', v));
  socket.on('game:view', (v: unknown) => receiveView('game:view', v));
  socket.on('game:result', (v: unknown) => receiveView('game:result', v));
  socket.on('session:status', (v: unknown) => {
    store.receiveStatus(v);
    if (!store.snapshot.controlReady) cancel();
    sync();
  });
  socket.on('command:ack', (raw: unknown) => {
    const ack = readAck(raw);
    if (!ack || !store.receiveAck(ack) || !ack.commandId) {
      sync();
      return;
    }
    const p = store.snapshot.pending[ack.commandId];
    if (ack.ok && p && (p.event === 'room:create' || p.event === 'room:join'))
      store.selectRoom(ack.roomId);
    const group = waiters.get(ack.commandId);
    if (group) {
      const w = group.values().next().value;
      if (w) {
        group.delete(w);
        clearTimeout(w.timer);
        w.resolve(ack);
      }
      if (!group.size) waiters.delete(ack.commandId);
    }
    if (!store.snapshot.controlReady) cancel();
  });
  async function identity<K extends 'guest' | 'resume' | 'account-resume'>(
    kind: K,
    payload: Record<string, unknown>,
  ): Promise<K extends 'guest' ? GuestResponse : ResumeResponse> {
    if (!socket.connected || store.snapshot.status === 'takenOver')
      throw Error('CONTROL_UNAVAILABLE');
    const requestId = crypto.randomUUID(),
      current = connection,
      expectedCredential = identitySessionId();
    cancel();
    identityPending++;
    pendingIdentityRequest = requestId;
    identityFrames.length = 0;
    try {
      store.beginIdentity(current, requestId);
      const response: unknown = await new Promise((resolve, reject) =>
        socket
          .timeout(timeout)
          .emit(
            'session:' + kind,
            { requestId, ...payload },
            (error: Error | null, value: unknown) =>
              error ? reject(Error('IDENTITY_TIMEOUT')) : resolve(value),
          ),
      );
      const parsed = kind === 'guest' ? readGuest(response) : readResume(response);
      if (identitySessionId() !== expectedCredential) {
        invalidateCredentials();
        throw Error('ENTRY_IDENTITY_CHANGED');
      }
      if (!parsed || parsed.requestId !== requestId) throw Error('INVALID_IDENTITY_RESPONSE');
      if (kind === 'account-resume' && parsed.ok && parsed.sessionId !== expectedCredential) {
        socket.disconnect();
        throw Error('ENTRY_IDENTITY_CHANGED');
      }
      const accepted = store.establishIdentity(
        parsed,
        current,
        requestId,
        kind === 'guest' ? 'guest' : 'resume',
      );
      if (parsed.ok && !accepted) throw Error('STALE_IDENTITY_RESPONSE');
      if (parsed.ok && accepted && pendingIdentityRequest === requestId) {
        const frames = identityFrames.splice(0);
        pendingIdentityRequest = null;
        if ('outcome' in parsed && parsed.outcome === 'seatRestored')
          for (const frame of frames) {
            if (
              frame.connection !== current ||
              frame.value.serverEpoch !== parsed.serverEpoch ||
              frame.value.roomId !== parsed.roomView.roomId
            )
              continue;
            if (
              frame.event === 'game:view' &&
              'self' in frame.value &&
              frame.value.self.participantId !== parsed.participantId
            )
              continue;
            applyView(frame.event, frame.value);
          }
      }
      if (parsed.ok && accepted) {
        const old = credentials.read();
        if ('resumeToken' in parsed)
          credentials.write({
            sessionId: parsed.sessionId,
            resumeToken: parsed.resumeToken,
            expiresAt: parsed.expiresAt,
          });
        else if (kind === 'resume' && old && old.sessionId === parsed.sessionId)
          credentials.write({ ...old, expiresAt: parsed.expiresAt });
      }
      return parsed as K extends 'guest' ? GuestResponse : ResumeResponse;
    } finally {
      if (pendingIdentityRequest === requestId) {
        pendingIdentityRequest = null;
        identityFrames.length = 0;
      }
      identityPending--;
    }
  }
  function guest(nickname: string) {
    return identity('guest', { nickname });
  }
  function resume() {
    assertCredentialIdentity();
    const saved = credentials.read();
    const account = accountId();
    const sessionId = account ?? saved?.sessionId;
    if (!sessionId) throw Error('NO_CREDENTIAL');
    const prior = locator.read(),
      location = prior?.sessionId === sessionId ? prior : null;
    return identity(account ? 'account-resume' : 'resume', {
      ...(account ? {} : { resumeToken: saved!.resumeToken }),
      roomId: store.snapshot.selectedRoomId ?? location?.roomId ?? null,
      lastSeenHandId: store.snapshot.playerView?.handId ?? location?.lastSeenHandId ?? null,
      lastSeenRoomVersion:
        store.snapshot.roomView?.roomVersion ?? location?.lastSeenRoomVersion ?? null,
      lastSeenHandVersion:
        store.snapshot.playerView?.handVersion ?? location?.lastSeenHandVersion ?? null,
    });
  }
  async function sendCommand<K extends MutatingEventName>(
    event: K,
    payload: MutatingCommandMap[K],
  ): Promise<CommandAck> {
    assertCredentialIdentity();
    if (!socket.connected || !store.snapshot.controlReady) throw Error('CONTROL_UNAVAILABLE');
    const prior = store.snapshot.pending[payload.commandId];
    const canonical = (v: unknown): string =>
      JSON.stringify(
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, x]) => [k, JSON.parse(canonical(x))]),
            )
          : v,
      );
    if (prior && (prior.event !== event || canonical(prior.payload) !== canonical(payload)))
      throw Error('COMMAND_ID_CONFLICT');
    if (event === 'game:action') {
      const p = payload as MutatingCommandMap['game:action'],
        v = store.snapshot.playerView;
      if (
        !v ||
        p.roomId !== v.roomId ||
        p.handId !== v.handId ||
        p.turnId !== v.turnId ||
        p.expectedVersion !== v.handVersion
      )
        throw Error('STALE_ACTION');
    }
    store.trackCommand(event, payload);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
          store.uncertain(payload.commandId);
          const group = waiters.get(payload.commandId);
          group?.delete(w);
          if (group?.size === 0) waiters.delete(payload.commandId);
          reject(Error('ACK_UNCERTAIN'));
        }, timeout),
        w = { resolve, reject, timer };
      const group = waiters.get(payload.commandId) ?? new Set();
      group.add(w);
      waiters.set(payload.commandId, group);
      socket.emit(event, payload);
    });
  }
  async function query<K extends keyof QueryRequestMap>(
    event: K,
    payload: Omit<QueryRequestMap[K], 'requestId'>,
  ): Promise<HistoryResponse | ReplayResponse> {
    assertCredentialIdentity();
    const session = store.snapshot.authContext?.sessionId,
      epoch = store.snapshot.activeEpoch,
      current = connection,
      requestId = crypto.randomUUID();
    if (!socket.connected || !store.snapshot.controlReady || !session || !epoch)
      throw Error('CONTROL_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      let finished = false;
      const cleanup = () => {
        finished = true;
        queryCancelers.delete(cancelQuery);
      };
      const cancelQuery = () => {
        if (!finished) {
          cleanup();
          reject(Error('QUERY_CANCELLED'));
        }
      };
      queryCancelers.add(cancelQuery);
      socket
        .timeout(timeout)
        .emit(event, { ...payload, requestId }, (error: Error | null, raw: unknown) => {
          if (finished) return;
          cleanup();
          if (error) {
            reject(Error('QUERY_TIMEOUT'));
            return;
          }
          if (
            current !== connection ||
            !store.snapshot.controlReady ||
            store.snapshot.authContext?.sessionId !== session ||
            store.snapshot.activeEpoch !== epoch ||
            credentialsChanged()
          ) {
            reject(Error('QUERY_STALE'));
            return;
          }
          const response = event === 'history:list' ? readHistory(raw) : readReplay(raw);
          if (!response || response.requestId !== requestId || response.serverEpoch !== epoch) {
            reject(Error('INVALID_QUERY_RESPONSE'));
            return;
          }
          resolve(response);
        });
    });
  }
  return {
    store,
    credentials,
    locator,
    loadAccount: () => options.account?.load() ?? Promise.resolve(),
    get identitySessionId() {
      return identitySessionId();
    },
    get credentialsChanged() {
      return credentialsChanged();
    },
    invalidateCredentials,
    get canAutoReconnect() {
      return (
        !closed &&
        !manualDisconnect &&
        !credentialsChanged() &&
        store.snapshot.status !== 'takenOver' &&
        store.snapshot.status !== 'expired'
      );
    },
    permitRecovery() {
      if (
        closed ||
        credentialsChanged() ||
        store.snapshot.status === 'takenOver' ||
        store.snapshot.status === 'expired'
      )
        return false;
      manualDisconnect = false;
      return true;
    },
    get connected() {
      return socket.connected;
    },
    connect(): Promise<void> {
      if (closed) return Promise.reject(Error('CLIENT_CLOSED'));
      if (socket.connected) return Promise.resolve();
      manualDisconnect = false;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(Error('CONNECT_TIMEOUT'));
        }, timeout);
        const cleanup = () => {
            connecting.delete(cancelConnect);
            clearTimeout(timer);
            socket.off('connect', onConnect);
            socket.off('connect_error', onError);
          },
          onConnect = () => {
            cleanup();
            resolve();
          },
          onError = () => {
            cleanup();
            reject(Error('CONNECT_FAILED'));
          },
          cancelConnect = () => {
            cleanup();
            reject(Error('CONTROL_UNAVAILABLE'));
          };
        connecting.add(cancelConnect);
        socket.once('connect', onConnect);
        socket.once('connect_error', onError);
        socket.connect();
      });
    },
    guest,
    resume,
    sendCommand,
    historyList: (params: { cursor: string | null; limit?: number }) =>
      query('history:list', params) as Promise<HistoryResponse>,
    replayGet: (handId: string) => query('replay:get', { handId }) as Promise<ReplayResponse>,
    disconnect() {
      manualDisconnect = true;
      cancelConnecting();
      socket.disconnect();
      store.disconnect();
      cancel();
    },
    close() {
      closed = true;
      cancelConnecting();
      identityFrames.length = 0;
      pendingIdentityRequest = null;
      manualDisconnect = true;
      removeRemember();
      socket.disconnect();
      socket.removeAllListeners();
      cancel();
      store.close();
    },
  };
}
