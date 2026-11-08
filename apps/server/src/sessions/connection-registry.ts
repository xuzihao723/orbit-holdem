import type { ControlContext } from './session-types.js';
function same(a: ControlContext | undefined, b: ControlContext): boolean {
  return (
    !!a &&
    a.sessionId === b.sessionId &&
    a.socketId === b.socketId &&
    a.connectionGeneration === b.connectionGeneration
  );
}
export class ConnectionRegistry {
  #listeners = new Set<
    (sessionId: string, previous: ControlContext | null, current: ControlContext | null) => void
  >();
  onChange(
    listener: (
      sessionId: string,
      previous: ControlContext | null,
      current: ControlContext | null,
    ) => void,
  ) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  private notify(
    sessionId: string,
    previous: ControlContext | null,
    current: ControlContext | null,
  ) {
    for (const listener of this.#listeners) {
      try {
        listener(sessionId, previous, current);
      } catch {
        /* State is already committed. */
      }
    }
  }

  #bySession = new Map<string, ControlContext>();
  #bySocket = new Map<string, ControlContext>();
  bind(value: ControlContext): ControlContext | null {
    if (
      !value ||
      typeof value.socketId !== 'string' ||
      !value.socketId.trim() ||
      typeof value.sessionId !== 'string' ||
      !value.sessionId.trim() ||
      !Number.isSafeInteger(value.connectionGeneration) ||
      value.connectionGeneration < 1
    )
      throw new Error('INVALID_CONTROL_CONTEXT');
    const context = Object.freeze({
        socketId: value.socketId,
        sessionId: value.sessionId,
        connectionGeneration: value.connectionGeneration,
        ...(value.accountLoginHash ? { accountLoginHash: value.accountLoginHash } : {}),
      }),
      previous = this.#bySession.get(context.sessionId);
    if (previous && previous.connectionGeneration >= context.connectionGeneration)
      throw new Error('INVALID_CONNECTION_GENERATION');
    const oldSocket = this.#bySocket.get(context.socketId);
    if (oldSocket && oldSocket.sessionId !== context.sessionId) this.release(oldSocket);
    this.#bySession.set(context.sessionId, context);
    this.#bySocket.set(context.socketId, context);
    this.notify(context.sessionId, previous ?? null, context);
    return previous ?? null;
  }
  getCurrent(sessionId: string): ControlContext | null {
    return this.#bySession.get(sessionId) ?? null;
  }
  isCurrent(context: ControlContext): boolean {
    return same(this.#bySession.get(context.sessionId), context);
  }
  getBySocket(socketId: string): ControlContext | null {
    return this.#bySocket.get(socketId) ?? null;
  }
  release(context: ControlContext): void {
    if (same(this.#bySocket.get(context.socketId), context))
      this.#bySocket.delete(context.socketId);
    if (this.isCurrent(context)) {
      this.#bySession.delete(context.sessionId);
      this.notify(context.sessionId, context, null);
    }
  }
  clear(): void {
    for (const context of this.#bySession.values()) this.notify(context.sessionId, context, null);
    this.#listeners.clear();
    this.#bySession.clear();
    this.#bySocket.clear();
  }
}
