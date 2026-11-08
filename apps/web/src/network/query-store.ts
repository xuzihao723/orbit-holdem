export class QueryStore<T> {
  private generation = 0;
  private listeners = new Set<() => void>();
  private value: Readonly<{
    binding: string;
    phase: 'idle' | 'loading' | 'ready' | 'error';
    data: T | null;
    error: string;
  }> = Object.freeze({ binding: '', phase: 'idle', data: null, error: '' });
  get snapshot() {
    return this.value;
  }
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  private publish(value: typeof this.value) {
    this.value = Object.freeze(value);
    for (const l of this.listeners) l();
  }
  clear = () => {
    this.generation++;
    this.publish({ binding: '', phase: 'idle', data: null, error: '' });
  };
  async load(binding: string, loader: () => Promise<T>) {
    const generation = ++this.generation;
    this.publish({ binding, phase: 'loading', data: null, error: '' });
    try {
      const data = await loader();
      if (generation === this.generation)
        this.publish({ binding, phase: 'ready', data, error: '' });
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          binding,
          phase: 'error',
          data: null,
          error: error instanceof Error ? error.message : 'QUERY_FAILED',
        });
    }
  }
}
