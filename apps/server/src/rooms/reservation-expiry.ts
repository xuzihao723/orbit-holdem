import type { ServerClock } from '../game/turn-timer.js';
import type { ReservationBook, SeatReservation } from '../sessions/reservation-book.js';
export class ReservationExpiry {
  private tasks = new Map<string, unknown>();
  private remove: () => void;
  private closed = false;
  constructor(
    private clock: ServerClock,
    private book: ReservationBook,
    private due: (token: SeatReservation, isCurrent: () => boolean) => Promise<unknown>,
    private fault: (roomId: string) => void,
  ) {
    this.remove = book.subscribe((r, key) => {
      this.cancel(key);
      if (r) this.arm(r, key);
    });
  }
  private cancel(key: string) {
    const h = this.tasks.get(key);
    if (h !== undefined) {
      this.clock.clearTimer(h);
      this.tasks.delete(key);
    }
  }
  private arm(r: SeatReservation, key: string) {
    if (this.closed) return;
    try {
      const h = this.clock.setTimer(
        () => {
          this.tasks.delete(key);
          if (this.closed || this.book.get(r.roomId, r.participantId) !== r) return;
          try {
            if (this.clock.now() < r.reserveUntil) {
              this.arm(r, key);
              return;
            }
            void this.due(
              r,
              () =>
                !this.closed &&
                this.book.get(r.roomId, r.participantId) === r &&
                this.clock.now() >= r.reserveUntil,
            ).catch(() => this.fault(r.roomId));
          } catch {
            this.fault(r.roomId);
          }
        },
        Math.max(0, r.reserveUntil - this.clock.now()),
      );
      this.tasks.set(key, h);
    } catch {
      this.fault(r.roomId);
    }
  }
  close() {
    this.closed = true;
    this.remove();
    for (const key of [...this.tasks.keys()]) this.cancel(key);
  }
}
