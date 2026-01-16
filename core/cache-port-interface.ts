/* cache-port-interface.ts */

export interface CachePortInterface<TKey extends string> {
  <K extends TKey>(
    key: K,
  ): {
    init<TArgs, TResult>(config: {
      fn: (args: TArgs) => Promise<TResult>;
      ttl: number;
      onHit?: () => void;
      onMiss?: () => void;
      onError: (err: unknown) => void;
    }): void;

    call<TArgs, TResult>(args: TArgs): Promise<TResult>;

    invalidate(): void;
  };

  stats<K extends TKey>(
    key: K,
  ): {
    hits: number;
    misses: number;
    errors: number;
    entries: number;
    inFlight: number;
  };

  gc<K extends TKey>(key?: K): void;
}
