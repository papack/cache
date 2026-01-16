import type { CachePortInterface } from "./cache-port-interface";

type Entry<TArgs, TResult> = {
  fn: (args: TArgs) => Promise<TResult>;
  ttl: number;
  onHit?: () => void;
  onMiss?: () => void;
  onError: (err: unknown) => void;

  values: Map<string, { value: TResult; expires: number }>;
  inFlight: Map<string, Promise<TResult>>;

  stats: {
    hits: number;
    misses: number;
    errors: number;
  };
};

function normalizeArgs(args: unknown): string {
  return JSON.stringify(args);
}

export function createCache<TKey extends string>(): CachePortInterface<TKey> {
  const entries = new Map<TKey, Entry<any, any>>();

  function getEntry<K extends TKey>(key: K): Entry<any, any> {
    const entry = entries.get(key);
    if (!entry) {
      throw new Error(`Cache key not initialized: ${String(key)}`);
    }
    return entry;
  }

  const cache = (<K extends TKey>(key: K) => {
    return {
      init(config: {
        fn: (args: any) => Promise<any>;
        ttl: number;
        onError: (err: unknown) => void;
        onHit?: () => void;
        onMiss?: () => void;
      }) {
        if (entries.has(key)) {
          throw new Error(`Cache key already initialized: ${String(key)}`);
        }

        entries.set(key, {
          fn: config.fn,
          ttl: config.ttl,
          onHit: config.onHit,
          onMiss: config.onMiss,
          onError: config.onError,

          values: new Map(),
          inFlight: new Map(),

          stats: {
            hits: 0,
            misses: 0,
            errors: 0,
          },
        });
      },

      async call(args: any) {
        const entry = getEntry(key);
        const now = Date.now();
        const argKey = normalizeArgs(args);

        const cached = entry.values.get(argKey);
        if (cached && cached.expires > now) {
          entry.stats.hits++;
          entry.onHit?.();
          return cached.value;
        }

        if (entry.inFlight.has(argKey)) {
          return entry.inFlight.get(argKey)!;
        }

        entry.stats.misses++;
        entry.onMiss?.();

        const promise = entry
          .fn(args)
          .then((result) => {
            entry.values.set(argKey, {
              value: result,
              expires: now + entry.ttl,
            });
            return result;
          })
          .catch((err) => {
            entry.stats.errors++;
            entry.onError(err);
            entry.values.clear(); // logical invalidate on error
            throw err;
          })
          .finally(() => {
            entry.inFlight.delete(argKey);
          });

        entry.inFlight.set(argKey, promise);
        return promise;
      },

      invalidate() {
        const entry = getEntry(key);
        entry.values.clear();
        entry.inFlight.clear();
      },
    };
  }) as CachePortInterface<TKey>;

  cache.stats = (key) => {
    const entry = getEntry(key);
    return {
      hits: entry.stats.hits,
      misses: entry.stats.misses,
      errors: entry.stats.errors,
      entries: entry.values.size,
      inFlight: entry.inFlight.size,
    };
  };

  cache.gc = (key?) => {
    const now = Date.now();
    const keys = key ? [key] : Array.from(entries.keys());

    for (const k of keys) {
      const entry = entries.get(k);
      if (!entry) continue;

      for (const [argKey, value] of entry.values) {
        if (value.expires <= now) {
          entry.values.delete(argKey);
        }
      }
    }
  };

  return cache;
}
