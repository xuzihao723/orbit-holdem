import type { createSocketClient } from './socket-client.js';
interface RetryClock {
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}
export class ResumeCoordinator {
  private active = false;
  private closed = false;
  private generation = 0;
  private attempts = 0;
  private timer: unknown | null = null;
  private working: Promise<void> | null = null;
  private remove: () => void;
  private clock: RetryClock;
  constructor(
    private client: ReturnType<typeof createSocketClient>,
    options: { clock?: RetryClock } = {},
  ) {
    this.clock = options.clock ?? {
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    this.remove = client.store.subscribe(() => this.changed());
  }
  private cancelTimer() {
    if (this.timer !== null) {
      this.clock.clearTimer(this.timer);
      this.timer = null;
    }
  }
  private blocked() {
    const s = this.client.store.snapshot.status;
    return s === 'takenOver' || s === 'expired' || !this.client.canAutoReconnect;
  }
  private changed() {
    if (!this.active) return;
    if (this.blocked()) {
      this.cancelTimer();
      return;
    }
    if (this.client.store.snapshot.controlReady) {
      this.cancelTimer();
      this.attempts = 0;
      return;
    }
    if (
      this.client.store.snapshot.status === 'disconnected' &&
      !this.working &&
      this.timer === null
    )
      void this.attempt(this.generation);
  }
  start(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.working) return this.working;
    if (!this.client.permitRecovery()) return Promise.resolve();
    this.active = true;
    this.cancelTimer();
    this.attempts = 0;
    return this.attempt(++this.generation);
  }
  watch() {
    if (!this.closed && this.client.store.snapshot.controlReady && this.client.permitRecovery())
      this.active = true;
  }
  private attempt(generation: number): Promise<void> {
    if (
      !this.active ||
      this.closed ||
      generation !== this.generation ||
      this.blocked() ||
      !this.client.identitySessionId
    )
      return Promise.resolve();
    const run = async () => {
      this.attempts++;
      let minimumDelay = 0;
      try {
        await this.client.connect();
        if (!this.active || generation !== this.generation) return;
        const response = await this.client.resume();
        if (response.ok) this.attempts = 0;
        else if (response.code === 'PERSISTENCE_UNAVAILABLE' || response.code === 'RATE_LIMITED') {
          minimumDelay = response.retryAfterMs ?? 0;
          throw Error('RETRYABLE_IDENTITY_FAILURE');
        } else {
          this.active = false;
          if (!this.blocked()) this.client.disconnect();
        }
      } catch {
        if (!this.active || generation !== this.generation || this.blocked()) return;
        if (this.attempts >= 6) {
          this.active = false;
          this.client.disconnect();
          return;
        }
        const delay = Math.max(minimumDelay, [500, 1000, 2000, 4000, 8000][this.attempts - 1]!);
        this.timer = this.clock.setTimer(() => {
          this.timer = null;
          void this.attempt(generation);
        }, delay);
      }
    };
    const promise = run();
    this.working = promise;
    void promise.finally(() => {
      if (this.working === promise) this.working = null;
    });
    return promise;
  }
  stop() {
    this.active = false;
    this.generation++;
    this.cancelTimer();
    if (this.working) {
      this.working = null;
      this.client.disconnect();
    }
  }
  close() {
    this.closed = true;
    this.stop();
    this.remove();
  }
}
