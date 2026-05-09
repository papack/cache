type CacheOptions = {
  key: string;
  ttl?: number;
};

type Entry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, Entry<any>>();
const inflight = new Map<string, Promise<any>>();

export async function cache<T>(
  fn: () => Promise<T> | T,
  options: CacheOptions,
): Promise<T> {
  const { key, ttl = Infinity } = options;

  // kein cache -> nur inflight dedupe
  if (ttl === 0) {
    const running = inflight.get(key);

    if (running) {
      return running;
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);

    return promise;
  }

  const now = Date.now();

  // cache hit
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    return existing.value;
  }

  if (existing) {
    store.delete(key);
  }

  // inflight dedupe
  const running = inflight.get(key);

  if (running) {
    return running;
  }

  const promise = (async () => {
    try {
      const value = await fn();

      store.set(key, {
        value,
        expiresAt: ttl === Infinity ? Infinity : now + ttl,
      });

      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);

  return promise;
}
