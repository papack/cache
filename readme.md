# @papack/cache

Minimal async in-memory cache with built-in Promise deduplication.

## Features

- Async-first
- Promise-based caching
- TTL support
- In-flight deduplication
- No background timers
- Automatic cleanup of expired entries
- Errors are never cached
- Tiny API surface

## Installation

```bash
bun add @papack/cache
```

## Usage

```ts
import { Cache } from "@papack/cache";

const cache = new Cache();

const value = await cache.get(
  "random",
  async () => {
    return Math.random();
  },
  1000,
);
```

## API

### Create Cache

```ts
const cache = new Cache();
```

---

### `cache.get(key, fn, ttl?)`

```ts
cache.get<T>(
  key: string,
  fn: () => Promise<T>,
  ttl?: number,
): Promise<T>;
```

### Parameters

| parameter | description                    |
| --------- | ------------------------------ |
| `key`     | cache key                      |
| `fn`      | async function                 |
| `ttl`     | cache duration in milliseconds |

### Example

```ts
const user = await cache.get(
  `user:${id}`,
  async () => {
    const res = await fetch(`/api/users/${id}`);

    if (!res.ok) {
      throw new Error("failed");
    }

    return res.json();
  },
  30_000,
);
```

## TTL Semantics

### `ttl > 0`

Normal caching.

```ts
ttl: 1000;
```

Behavior:

- Promise is cached
- entry expires after TTL

---

### `ttl: Infinity`

Permanent cache entry.

```ts
ttl: Infinity;
```

Behavior:

- entry never expires
- remains until `clear()` or process restart

Use only with bounded key space.

## In-Flight Deduplication

Concurrent calls with the same key share the same Promise.

```ts
const results = await Promise.all([
  cache.get("users", fetchUsers, 1000),
  cache.get("users", fetchUsers, 1000),
  cache.get("users", fetchUsers, 1000),
]);
```

Only one `fetchUsers()` execution occurs.

All callers receive the same result.

## Error Semantics

Errors are never cached.

```ts
await cache.get(
  "users",
  async () => {
    throw new Error("boom");
  },
  1000,
);
```

Behavior:

- all concurrent callers receive the same error
- failed entry is removed automatically
- next call retries normally

## Expiration Cleanup

The cache performs lazy cleanup.

Every 1000 requests:

- expired entries are scanned
- expired keys are removed

No timers or background GC are used.

## Clear Cache

```ts
cache.clear();
```

Removes all entries immediately.

## Cache Keys

The cache operates strictly by key.

```ts
"user:123";
```

The library does not inspect function arguments.

If argument-sensitive caching is needed, encode it into the key:

```ts
`user:${id}`;
```
