export interface SeatReservation {
  readonly roomId: string;
  readonly participantId: string;
  readonly disconnectGeneration: number;
  readonly offlineAt: number;
  readonly reserveUntil: number;
}
export class ReservationBook {
  private listeners = new Set<(reservation: SeatReservation | null, key: string) => void>();
  subscribe(listener: (reservation: SeatReservation | null, key: string) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed(key: string) {
    for (const listener of this.listeners) listener(this.entries.get(key) ?? null, key);
  }
  private entries = new Map<string, SeatReservation>();
  constructor(private now: () => number) {}
  private key(roomId: string, participantId: string) {
    return roomId + '\0' + participantId;
  }
  disconnect(roomId: string, participantId: string, generation: number) {
    const key = this.key(roomId, participantId);
    if (this.entries.has(key)) return;
    const now = this.now();
    this.entries.set(
      key,
      Object.freeze({
        roomId,
        participantId,
        disconnectGeneration: generation,
        offlineAt: now,
        reserveUntil: now + 120000,
      }),
    );
    this.changed(key);
  }
  get(roomId: string, participantId: string) {
    return this.entries.get(this.key(roomId, participantId)) ?? null;
  }
  allowed(roomId: string, participantId: string) {
    const r = this.get(roomId, participantId);
    return !r || this.now() < r.reserveUntil;
  }
  restore(roomId: string, participantId: string) {
    const key = this.key(roomId, participantId);
    this.entries.delete(key);
    this.changed(key);
  }
  all() {
    return [...this.entries.values()];
  }
  clear() {
    for (const key of [...this.entries.keys()]) {
      this.entries.delete(key);
      this.changed(key);
    }
    this.entries.clear();
  }
}
