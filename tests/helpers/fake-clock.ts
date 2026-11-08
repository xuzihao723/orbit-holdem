export class FakeClock {
  private time = 0;
  private nextId = 0;
  private tasks = new Map<number, { at: number; callback: () => void }>();
  flush: () => Promise<void> = async () => {};
  now = () => this.time;
  setTimer = (callback: () => void, delayMs: number) => {
    const id = ++this.nextId;
    this.tasks.set(id, { at: this.time + delayMs, callback });
    return id;
  };
  clearTimer = (handle: unknown) => {
    this.tasks.delete(Number(handle));
  };
  get pending() {
    return this.tasks.size;
  }
  async advanceTo(target: number, run = true) {
    if (target < this.time) throw Error('CLOCK_BACKWARDS');
    if (!run) {
      this.time = target;
      return;
    }
    let count = 0;
    while (true) {
      const entry = [...this.tasks]
        .filter(([, v]) => v.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry) break;
      if (++count > 1000) throw Error('TIMER_LIMIT');
      this.tasks.delete(entry[0]);
      this.time = Math.max(this.time, entry[1].at);
      entry[1].callback();
      await this.flush();
    }
    this.time = target;
    await this.flush();
  }
}
