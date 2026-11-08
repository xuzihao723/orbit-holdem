import type {
  GuestResponse,
  ResumeResponse,
  RoomView,
  PlayerView,
  SessionGuestRequest,
  SessionResumeRequest,
  ServerMeta,
} from '@orbit/protocol';
import type { PersistenceRepositories, PokerDatabase } from '../persistence/repositories.js';
import type { ConnectionRegistry } from './connection-registry.js';
export interface ControlContext {
  readonly socketId: string;
  readonly sessionId: string;
  readonly connectionGeneration: number;
  readonly accountLoginHash?: string;
}
export type ResumeResolution =
  | {
      readonly outcome: 'identityOnly';
      readonly reason: 'notSeated' | 'seatExpired' | 'roomClosed';
      readonly roomView: null;
      readonly playerView: null;
    }
  | {
      readonly outcome: 'handInterrupted';
      readonly interruptedHandId: string;
      readonly roomView: null;
      readonly playerView: null;
    }
  | {
      readonly outcome: 'seatRestored';
      readonly participantId: string;
      readonly roomView: RoomView;
      readonly playerView: PlayerView | null;
    };
export interface ResumeContextResolver {
  finalize?(
    input: Parameters<ResumeContextResolver['resolve']>[0],
    resolution: ResumeResolution,
  ): ResumeResolution;
  resolve(input: {
    readonly sessionId: string;
    readonly roomId: string | null;
    readonly lastSeenHandId: string | null;
    readonly control?: ControlContext;
  }): ResumeResolution | Promise<ResumeResolution>;
}
export interface SessionDependencies {
  readonly repository: PersistenceRepositories;
  readonly accounts?: PokerDatabase['accounts'];
  readonly now: () => number;
  readonly serverEpoch: string;
  readonly contextResolver: ResumeContextResolver;
  readonly onTakeover?: (previous: ControlContext, current: ControlContext) => void;
}
export type ControllerCheck =
  | { readonly ok: true; readonly context: ControlContext }
  | { readonly ok: false; readonly reason: 'SESSION_EXPIRED' | 'SESSION_TAKEN_OVER' };
export interface SessionService {
  guest(socketId: string, input: SessionGuestRequest): GuestResponse;
  resume(socketId: string, input: SessionResumeRequest): Promise<ResumeResponse>;
  resumeAccount(
    socketId: string,
    input: Omit<SessionResumeRequest, 'resumeToken'>,
    loginHash: string,
  ): Promise<ResumeResponse>;
  checkController(context: ControlContext): ControllerCheck;
  disconnect(context: ControlContext): void;
}
export interface SessionRuntime {
  canAccessSeat(roomId: string, participantId: string): boolean;
  readonly service: SessionService;
  readonly registry: ConnectionRegistry;
  readonly serverEpoch: string;
  meta(): ServerMeta;
  onTakeover(listener: (previous: ControlContext, current: ControlContext) => void): () => void;
  close(): void;
}
