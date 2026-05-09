# @papack/cache

Minimal async in-memory cache with built-in in-flight deduplication.

## Features

- Async-first
- Explicit per-call API
- TTL-based caching
- In-flight deduplication (stampede protection)
- No background timers
- No metrics
- No lifecycle/init phase
- Errors are never cached

## Installation

```bash
bun add @papack/cache
```

## Usage

```ts
import { cache } from "@papack/cache";

const value = await cache(
  async () => {
    return Math.random();
  },
  {
    key: "random",
    ttl: 1000,
  },
);
```

## API

```ts
cache(fn, options);
```

### Parameters

```ts
{
  key: string;
  ttl?: number;
}
```

| option | description                    |
| ------ | ------------------------------ |
| `key`  | cache key                      |
| `ttl`  | cache duration in milliseconds |

## TTL Semantics

### `ttl > 0`

Normal caching:

```ts
ttl: 1000;
```

- value is cached
- expires after TTL

---

### `ttl: 0`

No caching.

Behavior:

- no cache entry is stored
- concurrent in-flight calls are still deduplicated
- once resolved, result is discarded

Useful for request collapsing without persistence.

---

### `ttl: Infinity`

Permanent cache entry.

```ts
ttl: Infinity;
```

Behavior:

- value never expires
- entry remains until process restart

Use only with bounded key space.

## In-Flight Deduplication

Concurrent calls with the same key share the same Promise.

```ts
const results = await Promise.all([
  cache(fetchUsers, {
    key: "users",
    ttl: 1000,
  }),

  cache(fetchUsers, {
    key: "users",
    ttl: 1000,
  }),

  cache(fetchUsers, {
    key: "users",
    ttl: 1000,
  }),
]);
```

Only one `fetchUsers()` runs.

All callers receive the same result.

## Error Semantics

Errors are never cached.

```ts
await cache(
  async () => {
    throw new Error("boom");
  },
  {
    key: "users",
    ttl: 1000,
  },
);
```

Behavior:

- all concurrent waiters receive the same error
- no cache entry is stored
- next call retries normally
- in-flight state is cleaned automatically

## Cache Keys

The cache operates strictly by key.

```ts
key: "users";
```

The library does not normalize arguments or inspect function input.

If argument-sensitive caching is needed, include it in the key:

```ts
key: `user:${id}`;
```

## Design Constraints

This cache intentionally does not provide:

- distributed storage
- LRU eviction
- background GC
- sliding TTL
- metrics/stats
- persistence
- serialization
- deep argument comparison

The contract is intentionally small and explicit.

## Example

```ts
import { cache } from "@papack/cache";

export async function getUser(id: string) {
  return cache(
    async () => {
      const res = await fetch(`https://api.example.com/users/${id}`);

      if (!res.ok) {
        throw new Error("failed");
      }

      return res.json();
    },
    {
      key: `user:${id}`,
      ttl: 30_000,
    },
  );
}
```
