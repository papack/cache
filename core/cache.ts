type Entry<T> = {
  promise: Promise<T>;
  expiresAt: number;
};

export class Cache {
  private store = new Map<string, Entry<unknown>>();
  private requests = 0;

  get<T>(key: string, fn: () => Promise<T>, ttl = Infinity): Promise<T> {
    const now = Date.now();

    if (++this.requests % 1000 === 0) {
      for (const [k, v] of this.store) {
        if (v.expiresAt <= now) {
          this.store.delete(k);
        }
      }
    }

    const existing = this.store.get(key);

    if (existing && existing.expiresAt > now) {
      return existing.promise as Promise<T>;
    }

    const promise = Promise.resolve()
      .then(fn)
      .catch((err) => {
        if (this.store.get(key)?.promise === promise) {
          this.store.delete(key);
        }

        throw err;
      });

    this.store.set(key, {
      promise,
      expiresAt: now + ttl,
    });

    return promise;
  }

  clear() {
    this.store.clear();
  }
}
