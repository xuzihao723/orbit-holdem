export interface RateScope {
  key: string;
  limit: number;
  windowMs: number;
}
interface Bucket extends RateScope {
  times: number[];
}
export class RateLimiter {
  #buckets = new Map<string, Bucket>();
  #last = 0;
  #closed = false;
  constructor(private maxBuckets = 10000) {
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 1) throw new Error('INVALID_RATE_CONFIG');
  }
  take(scopes: readonly RateScope[], now: number): number | null {
    if (this.#closed || !Number.isSafeInteger(now) || now < 0 || now < this.#last)
      throw new Error('INVALID_RATE_CLOCK');
    this.#last = now;
    if (scopes.length > this.maxBuckets) throw new Error('INVALID_RATE_CONFIG');
    const seen = new Set<string>();
    for (const s of scopes) {
      if (
        !s.key ||
        seen.has(s.key) ||
        !Number.isSafeInteger(s.limit) ||
        s.limit < 1 ||
        s.limit > 100000 ||
        !Number.isSafeInteger(s.windowMs) ||
        s.windowMs < 1 ||
        s.windowMs > 86400000
      )
        throw new Error('INVALID_RATE_CONFIG');
      seen.add(s.key);
      const old = this.#buckets.get(s.key);
      if (old && (old.limit !== s.limit || old.windowMs !== s.windowMs))
        throw new Error('INVALID_RATE_CONFIG');
    }
    for (const [key, b] of this.#buckets) {
      b.times = b.times.filter((t) => now - t < b.windowMs);
      if (!b.times.length) this.#buckets.delete(key);
    }
    let wait = 0;
    const missing = scopes.filter((s) => !this.#buckets.has(s.key)).length;
    if (this.#buckets.size + missing > this.maxBuckets) {
      const releases = [...this.#buckets.values()]
        .filter((b) => !seen.has(b.key))
        .map((b) => b.windowMs - (now - b.times[b.times.length - 1]!))
        .sort((a, b) => a - b);
      wait = releases[this.#buckets.size + missing - this.maxBuckets - 1]!;
    }
    for (const s of scopes) {
      const b = this.#buckets.get(s.key);
      if (b && b.times.length >= s.limit) wait = Math.max(wait, s.windowMs - (now - b.times[0]!));
    }
    if (wait) return wait;
    for (const s of scopes) {
      let b = this.#buckets.get(s.key);
      if (!b) {
        b = { ...s, times: [] };
        this.#buckets.set(s.key, b);
      }
      b.times.push(now);
    }
    return null;
  }
  clearPrefix(prefix: string) {
    for (const key of this.#buckets.keys()) if (key.startsWith(prefix)) this.#buckets.delete(key);
  }
  close() {
    this.#closed = true;
    this.#buckets.clear();
  }
}
