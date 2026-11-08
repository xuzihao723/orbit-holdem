import type { Server, Socket } from 'socket.io';
import type { MutatingEventName, RequestFailure, ErrorCode, FieldIssue } from '@orbit/protocol';
import type { SessionRuntime } from '../sessions/session-types.js';
import { SessionPayloadError } from '../sessions/input.js';
import { parseMutating, mutatingEvents } from './command-payloads.js';
import { parseQuery } from './query-payloads.js';
import { RateLimiter } from './rate-limit.js';
import { commandFailure, privateFailure } from './errors.js';
import { PayloadError } from './input.js';
import type {
  AuthenticatedCommand,
  CommandExecutor,
  TransportOptions,
  RateCategory,
  RatePolicy,
  QueryExecutor,
  AuthenticatedQuery,
} from './types.js';
const defaults: Record<RateCategory, RatePolicy> = {
  action: { connection: 10, session: 10, ip: 60, windowMs: 1000 },
  admission: { connection: 5, session: 5, ip: 30, windowMs: 60000 },
  management: { connection: 20, session: 20, ip: 120, windowMs: 1000 },
  identity: { connection: 10, session: 0, ip: 60, windowMs: 60000 },
  global: { connection: 50, session: 0, ip: 200, windowMs: 1000 },
};
export function registerCommandRouter(
  io: Server,
  runtime: SessionRuntime,
  executor?: CommandExecutor,
  options: TransportOptions = {},
  queryExecutor?: QueryExecutor,
) {
  const limiter = new RateLimiter(options.maxBuckets),
    now = options.now ?? (() => runtime.meta().serverTime),
    policies = { ...defaults, ...options.limits };
  let closed = false;
  const disposers = new Map<Socket, () => void>();
  function take(socket: Socket, category: RateCategory, sessionId?: string): number | null {
    const p = policies[category],
      ip =
        options.clientAddress?.(socket.request) ?? socket.handshake.address.replace(/^::ffff:/, '');
    return limiter.take(
      [
        { key: 'socket:' + socket.id + ':' + category, limit: p.connection, windowMs: p.windowMs },
        { key: 'ip:' + ip + ':' + category, limit: p.ip, windowMs: p.windowMs },
        ...(sessionId
          ? [
              {
                key: 'session:' + sessionId + ':' + category,
                limit: p.session,
                windowMs: p.windowMs,
              },
            ]
          : []),
      ],
      now(),
    );
  }
  function beforeIdentity(socket: Socket, _event: string, raw: unknown): RequestFailure | null {
    try {
      const wait = take(socket, 'global') ?? take(socket, 'identity');
      return wait === null ? null : privateFailure(runtime.meta(), raw, 'RATE_LIMITED', wait);
    } catch {
      return privateFailure(runtime.meta(), raw, 'PERSISTENCE_UNAVAILABLE');
    }
  }
  const onConnection = (socket: Socket) => {
    const onAny = (event: string, ...args: unknown[]) => {
      if (
        event === 'session:guest' ||
        event === 'session:resume' ||
        event === 'session:account-resume'
      )
        return;
      const raw = args[0],
        ack = args[args.length - 1];
      const reply = (code: ErrorCode, issues: FieldIssue[] = [], wait: number | null = null) => {
        if (closed || !socket.connected) return;
        if (event === 'history:list' || event === 'replay:get') {
          if (typeof ack === 'function')
            ack({ ...privateFailure(runtime.meta(), raw, code, wait), fieldIssues: issues });
        } else socket.emit('command:ack', commandFailure(runtime.meta(), raw, code, issues, wait));
      };
      void (async () => {
        try {
          if (closed) return;
          const receivedAt = now();
          let wait = take(socket, 'global');
          if (wait !== null) {
            reply('RATE_LIMITED', [], wait);
            return;
          }
          if (event === 'history:list' || event === 'replay:get') {
            const payload = parseQuery(event, raw);
            if (args.length !== 2 || typeof ack !== 'function')
              throw new PayloadError('request', 'invalidFormat');
            const control = runtime.registry.getBySocket(socket.id);
            if (!control) {
              reply('SESSION_EXPIRED');
              return;
            }
            const check = runtime.service.checkController(control);
            if (!check.ok) {
              reply(check.reason);
              return;
            }
            wait = take(socket, 'management', control.sessionId);
            if (wait !== null) {
              reply('RATE_LIMITED', [], wait);
              return;
            }
            if (!queryExecutor) {
              reply('INVALID_INPUT');
              return;
            }
            const result = await queryExecutor.executeQuery({
              event,
              payload,
              control,
              receivedAt,
            } as AuthenticatedQuery);
            const finalCheck = runtime.service.checkController(control);
            if (!finalCheck.ok) {
              reply(finalCheck.reason);
              return;
            }
            if (!closed && socket.connected) ack(result);
            return;
          }
          if (!mutatingEvents.includes(event as MutatingEventName))
            throw new PayloadError('event', 'invalidFormat');
          if (args.length > 1 && !(args.length === 2 && typeof ack === 'function'))
            throw new PayloadError('request', 'unknownField');
          const payload = parseMutating(event, raw),
            control = runtime.registry.getBySocket(socket.id);
          if (!control) {
            socket.emit('command:ack', commandFailure(runtime.meta(), raw, 'SESSION_EXPIRED'));
            return;
          }
          const check = runtime.service.checkController(control);
          if (!check.ok) {
            socket.emit('command:ack', commandFailure(runtime.meta(), raw, check.reason));
            return;
          }
          const category =
            event === 'game:action'
              ? 'action'
              : event === 'room:create' || event === 'room:join'
                ? 'admission'
                : 'management';
          wait = take(socket, category, control.sessionId);
          if (wait !== null) {
            reply('RATE_LIMITED', [], wait);
            return;
          }
          if (!executor) throw new PayloadError('event', 'invalidFormat');
          const trusted = Object.freeze({
            event,
            payload,
            control,
            receivedAt,
          }) as AuthenticatedCommand;
          const result = await executor.execute(trusted);
          if (!closed && socket.connected) socket.emit('command:ack', result);
          try {
            executor.afterAck?.(trusted, result);
          } catch {
            /* A notification failure cannot replace a committed ack. */
          }
        } catch (error) {
          if (!closed && socket.connected)
            reply(
              error instanceof PayloadError
                ? error.code
                : error instanceof SessionPayloadError
                  ? 'INVALID_INPUT'
                  : 'PERSISTENCE_UNAVAILABLE',
              error instanceof SessionPayloadError ? error.fieldIssues : [],
            );
        }
      })();
    };
    const disconnect = () => {
      limiter.clearPrefix('socket:' + socket.id + ':');
      disposers.get(socket)?.();
      disposers.delete(socket);
    };
    socket.onAny(onAny);
    socket.on('disconnect', disconnect);
    disposers.set(socket, () => {
      socket.offAny(onAny);
      socket.off('disconnect', disconnect);
    });
  };
  io.on('connection', onConnection);
  return {
    beforeIdentity,
    close() {
      closed = true;
      io.off('connection', onConnection);
      for (const dispose of disposers.values()) dispose();
      disposers.clear();
      limiter.close();
    },
  };
}
