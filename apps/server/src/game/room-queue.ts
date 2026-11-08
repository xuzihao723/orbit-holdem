export class RoomQueue {
  #tails = new Map<string, Promise<void>>();
  #closed = false;
  #closing: Promise<void> | undefined;
  run<T>(key: string, task: () => T | Promise<T>): Promise<T> {
    return this.runKeys(['room:' + key], task);
  }
  runKeys<T>(input: readonly string[], task: () => T | Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('QUEUE_CLOSED'));
    const keys = [...new Set(input)];
    if (!keys.length || keys.some((k) => !k.trim()))
      return Promise.reject(new Error('INVALID_QUEUE_KEYS'));
    const priors = [
      ...new Set(
        keys.map((k) => this.#tails.get(k)).filter((p): p is Promise<void> => p !== undefined),
      ),
    ];
    const prior =
      priors.length === 1 ? priors[0]! : priors.length ? Promise.all(priors) : Promise.resolve();
    const result = prior.then(task);
    const tail = result.then(
      () => {},
      () => {},
    );
    for (const key of keys) this.#tails.set(key, tail);
    void tail.then(() => {
      for (const key of keys) if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }
  async idle(): Promise<void> {
    while (this.#tails.size) await Promise.all(this.#tails.values());
  }
  close(): Promise<void> {
    this.#closed = true;
    return (this.#closing ??= (async () => {
      await Promise.all(this.#tails.values());
    })());
  }
}
