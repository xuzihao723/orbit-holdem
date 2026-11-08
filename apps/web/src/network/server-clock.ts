export class ServerTimeClock {
  private latest = -1;
  private offset: number | null = null;
  observe(serverTime: number, clientTime: number) {
    if (
      !Number.isSafeInteger(serverTime) ||
      serverTime < 0 ||
      !Number.isFinite(clientTime) ||
      clientTime < 0 ||
      serverTime <= this.latest
    )
      return;
    this.latest = serverTime;
    this.offset = serverTime - clientTime;
  }
  remainingMs(deadline: number | null, clientTime: number): number | null {
    if (
      deadline === null ||
      !Number.isSafeInteger(deadline) ||
      deadline < 0 ||
      !Number.isFinite(clientTime) ||
      this.offset === null
    )
      return null;
    return Math.max(0, Math.min(30000, deadline - clientTime - this.offset));
  }
}
