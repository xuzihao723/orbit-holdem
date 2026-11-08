import type {
  RoomView,
  PlayerView,
  HandResultView,
  CommandAck,
  MutatingEventName,
  MutatingCommandMap,
} from '@orbit/protocol';
import {
  readRoom,
  readPlayer,
  readResult,
  readAck,
  readGuest,
  readResume,
  readStatus,
  freezeValue,
} from './wire-validate.js';
export interface PendingCommand {
  event: MutatingEventName;
  payload: MutatingCommandMap[MutatingEventName];
  status: 'pending' | 'uncertain' | 'confirmed';
  ack: CommandAck | null;
}
export interface ViewSnapshot {
  authContext: { sessionId: string; participantId: string | null; roomId: string | null } | null;
  interruptedHandId: string | null;
  activeEpoch: string | null;
  selectedRoomId: string | null;
  roomView: RoomView | null;
  playerView: PlayerView | null;
  result: HandResultView | null;
  controlReady: boolean;
  syncNeeded: boolean;
  status: 'disconnected' | 'authenticating' | 'ready' | 'takenOver' | 'expired';
  pending: Readonly<Record<string, PendingCommand>>;
}
export class ViewStore {
  private value: ViewSnapshot = {
    authContext: null,
    interruptedHandId: null,
    activeEpoch: null,
    selectedRoomId: null,
    roomView: null,
    playerView: null,
    result: null,
    controlReady: false,
    syncNeeded: false,
    status: 'disconnected',
    pending: {},
  };
  private connection = 0;
  private requestId: string | null = null;
  private sessionId: string | null = null;
  private buffer = new Map<string, PlayerView>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get snapshot(): Readonly<ViewSnapshot> {
    return this.value;
  }
  get bufferedHandCount() {
    return this.buffer.size;
  }
  private patch(p: Partial<ViewSnapshot>) {
    if (Object.entries(p).every(([k, v]) => Object.is(this.value[k as keyof ViewSnapshot], v)))
      return;
    this.value = freezeValue({ ...this.value, ...p });
    for (const listener of this.listeners)
      try {
        listener();
      } catch {
        /* Observers cannot undo received state. */
      }
  }
  beginConnection() {
    this.connection++;
    this.requestId = null;
    this.patch({ controlReady: false, status: 'authenticating', playerView: null, pending: {} });
    return this.connection;
  }
  beginIdentity(connection: number, requestId: string) {
    if (connection === this.connection) {
      this.buffer.clear();
      this.requestId = requestId;
      this.patch({
        controlReady: false,
        status: 'authenticating',
        playerView: null,
        pending: {},
        authContext: this.sessionId
          ? { sessionId: this.sessionId, participantId: null, roomId: null }
          : null,
      });
    }
  }
  establishIdentity(raw: unknown, connection: number, requestId: string, kind: 'guest' | 'resume') {
    const identity = kind === 'guest' ? readGuest(raw) : readResume(raw);
    if (
      connection !== this.connection ||
      requestId !== this.requestId ||
      !identity ||
      identity.requestId !== requestId ||
      this.value.status === 'takenOver'
    )
      return false;
    this.requestId = null;
    if (!identity.ok) {
      this.patch({
        controlReady: false,
        status:
          identity.code === 'SESSION_EXPIRED'
            ? 'expired'
            : identity.code === 'SESSION_TAKEN_OVER'
              ? 'takenOver'
              : 'authenticating',
      });
      return false;
    }
    if (identity.serverEpoch !== this.value.activeEpoch || identity.sessionId !== this.sessionId) {
      this.buffer.clear();
      this.patch({
        selectedRoomId: null,
        roomView: null,
        playerView: null,
        result: null,
        pending: {},
      });
    }
    this.sessionId = identity.sessionId;
    this.patch({
      activeEpoch: identity.serverEpoch,
      authContext: { sessionId: identity.sessionId, participantId: null, roomId: null },
      interruptedHandId: null,
      controlReady: true,
      syncNeeded: false,
      status: 'ready',
    });
    if ('outcome' in identity && identity.outcome === 'seatRestored') {
      this.selectRoom(identity.roomView.roomId);
      this.patch({
        authContext: {
          sessionId: identity.sessionId,
          participantId: identity.participantId,
          roomId: identity.roomView.roomId,
        },
      });
      this.receiveRoom(identity.roomView);
      if (identity.playerView) this.receivePlayer(identity.playerView);
    } else if ('outcome' in identity) {
      this.buffer.clear();
      this.patch({
        selectedRoomId: null,
        roomView: null,
        playerView: null,
        result: null,
        pending: {},
        interruptedHandId:
          identity.outcome === 'handInterrupted' ? identity.interruptedHandId : null,
      });
    }
    return true;
  }
  selectRoom(id: string) {
    if (id === this.value.selectedRoomId) return;
    this.buffer.clear();
    this.patch({
      selectedRoomId: id,
      roomView: null,
      playerView: null,
      result: null,
      interruptedHandId: null,
      authContext: this.sessionId
        ? { sessionId: this.sessionId, participantId: null, roomId: null }
        : null,
    });
  }
  private epoch(epoch: string) {
    if (epoch === this.value.activeEpoch) return true;
    if (this.value.status !== 'takenOver' && this.value.status !== 'expired') {
      this.buffer.clear();
      this.patch({ syncNeeded: true, controlReady: false, playerView: null, pending: {} });
    }
    return false;
  }
  receiveRoom(raw: unknown) {
    const v = readRoom(raw);
    if (!v || !this.epoch(v.serverEpoch) || v.roomId !== this.value.selectedRoomId) return false;
    const old = this.value.roomView;
    if (old && v.roomVersion <= old.roomVersion) return false;
    this.patch({
      roomView: v,
      ...(old?.currentHandId !== v.currentHandId ? { playerView: null, result: null } : {}),
    });
    if (v.status === 'pausedFault' || v.status === 'closed') this.patch({ playerView: null });
    else {
      const p = v.currentHandId ? this.buffer.get(v.currentHandId) : null;
      if (p) {
        this.buffer.delete(p.handId);
        this.receivePlayer(p);
      }
    }
    return true;
  }
  receivePlayer(raw: unknown) {
    const v = readPlayer(raw);
    if (
      !v ||
      !this.epoch(v.serverEpoch) ||
      v.roomId !== this.value.selectedRoomId ||
      !this.value.controlReady ||
      this.value.status !== 'ready'
    )
      return false;
    if (this.value.roomView?.status === 'pausedFault' || this.value.roomView?.status === 'closed')
      return false;
    if (v.handId !== this.value.roomView?.currentHandId) {
      const existing = this.buffer.get(v.handId);
      if (!existing || v.handVersion > existing.handVersion) this.buffer.set(v.handId, v);
      while (this.buffer.size > 4) this.buffer.delete(this.buffer.keys().next().value!);
      return false;
    }
    const old = this.value.playerView;
    if (!old || v.handVersion > old.handVersion) {
      this.patch({ playerView: v });
      return true;
    }
    if (v.handVersion === old.handVersion && v.roomVersion > old.roomVersion) {
      this.patch({
        playerView: {
          ...old,
          roomVersion: v.roomVersion,
          self: { ...old.self, admission: v.self.admission, legalActions: v.self.legalActions },
        },
      });
      return true;
    }
    return false;
  }
  receiveResult(raw: unknown) {
    const v = readResult(raw);
    if (
      !v ||
      !this.epoch(v.serverEpoch) ||
      v.roomId !== this.value.selectedRoomId ||
      v.handId !== this.value.roomView?.currentHandId ||
      this.value.status === 'takenOver'
    )
      return false;
    if (this.value.result && v.handVersion <= this.value.result.handVersion) return false;
    this.patch({ result: v });
    return true;
  }
  trackCommand<K extends MutatingEventName>(event: K, payload: MutatingCommandMap[K]) {
    this.patch({
      pending: {
        ...this.value.pending,
        [payload.commandId]: freezeValue({
          event,
          payload: structuredClone(payload),
          status: 'pending',
          ack: null,
        }),
      },
    });
  }
  uncertain(id: string) {
    const p = this.value.pending[id];
    if (p) this.patch({ pending: { ...this.value.pending, [id]: { ...p, status: 'uncertain' } } });
  }
  receiveAck(raw: unknown) {
    const ack = readAck(raw);
    if (!ack || !this.epoch(ack.serverEpoch) || !ack.commandId) return false;
    const p = this.value.pending[ack.commandId];
    if (!p) return false;
    if (p)
      this.patch({
        pending: { ...this.value.pending, [ack.commandId]: { ...p, status: 'confirmed', ack } },
      });
    if (!ack.ok && (ack.code === 'SESSION_EXPIRED' || ack.code === 'SESSION_TAKEN_OVER'))
      this.receiveStatus({
        protocolVersion: ack.protocolVersion,
        serverEpoch: ack.serverEpoch,
        serverTime: ack.serverTime,
        status: ack.code === 'SESSION_EXPIRED' ? 'expired' : 'takenOver',
        connectionGeneration: null,
      });
    return true;
  }
  receiveStatus(raw: unknown) {
    const v = readStatus(raw);
    if (!v || !this.epoch(v.serverEpoch)) return;
    if (v.status === 'takenOver' || v.status === 'expired') {
      this.requestId = null;
      this.buffer.clear();
      this.patch({ status: v.status, controlReady: false, playerView: null, pending: {} });
    }
  }
  disconnect() {
    this.connection++;
    this.requestId = null;
    this.buffer.clear();
    this.patch({
      controlReady: false,
      status:
        this.value.status === 'takenOver' || this.value.status === 'expired'
          ? this.value.status
          : 'disconnected',
      authContext: this.sessionId
        ? { sessionId: this.sessionId, participantId: null, roomId: null }
        : null,
      playerView: null,
      pending: {},
    });
  }
  close() {
    this.disconnect();
    this.buffer.clear();
    this.sessionId = null;
    this.patch({
      authContext: null,
      interruptedHandId: null,
      activeEpoch: null,
      selectedRoomId: null,
      roomView: null,
      playerView: null,
      result: null,
    });
  }
}
