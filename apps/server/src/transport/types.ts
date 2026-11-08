import type { MutatingCommandMap, MutatingEventName, CommandAck } from '@orbit/protocol';
import type { ControlContext } from '../sessions/session-types.js';
import type { QueryRequestMap, HistoryResponse, ReplayResponse } from '@orbit/protocol';
import type { IncomingMessage } from 'node:http';
export type AuthenticatedQuery = {
  [K in keyof QueryRequestMap]: Readonly<{
    event: K;
    payload: Readonly<QueryRequestMap[K]>;
    control: ControlContext;
    receivedAt: number;
  }>;
}[keyof QueryRequestMap];
export interface QueryExecutor {
  executeQuery(query: AuthenticatedQuery): Promise<HistoryResponse | ReplayResponse>;
}
export type AuthenticatedCommand = {
  [K in MutatingEventName]: Readonly<{
    event: K;
    payload: Readonly<MutatingCommandMap[K]>;
    control: ControlContext;
    receivedAt: number;
  }>;
}[MutatingEventName];
export interface CommandExecutor {
  execute(command: AuthenticatedCommand): Promise<CommandAck>;
  afterAck?(command: AuthenticatedCommand, ack: CommandAck): void;
}
export type RateCategory = 'action' | 'admission' | 'management' | 'identity' | 'global';
export interface RatePolicy {
  connection: number;
  session: number;
  ip: number;
  windowMs: number;
}
export interface TransportOptions {
  now?: () => number;
  clientAddress?: (request: IncomingMessage) => string;
  maxBuckets?: number;
  limits?: Partial<Record<RateCategory, RatePolicy>>;
}
