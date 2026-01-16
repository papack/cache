# @papack/cache

Minimal, explicit in-memory cache.

Designed for **small–medium services** where correctness, predictability, and explicit control matter more than abstraction.

## Core Idea

- Typed cache keys (compile-time enforced at call sites)
- Explicit initialization per key
- Async-first, in-memory
- Deterministic, absolute TTL
- Built-in cache-stampede protection
- No background work
- No hidden behavior

It is a **strict cache** with a small, well-defined contract.

## Installation

```bash
bun add @papack/cache
```

## Instantiation

Keys are bound **once** at creation time and enforced everywhere.

```ts
type CacheKeys = "users" | "orders";

export const cache = createCache<CacheKeys>();
```

- Only keys from `CacheKeys` are allowed at compile time
- Key typos are compile-time errors
- Using a key before initialization throws at runtime

## Initialization (Required)

Each key must be initialized **exactly once**.

```ts
cache("users").init({
  fn: fetchUsers,
  ttl: 30_000,
  onHit: () => {},
  onMiss: () => {},
  onError: () => {},
});
```

Rules:

- `init` defines the function and TTL for the key
- Calling `init` twice throws
- Calling `call` before `init` throws
- `onError` is mandatory

## Read (Cache-Through)

```ts
const users = await cache("users").call({ active: true });
```

Behavior:

- First call → miss → `fn` runs
- Result is cached per `(key + normalized args)`
- Subsequent calls within TTL → hit
- Different args → different cache entries

## In-Flight Deduplication (Stampede Protection)

For each `(key + normalized args)`:

- Only **one** `fn` runs at a time
- Concurrent callers await the same Promise

On success:

- Result is cached once
- TTL starts after `fn` resolves
- All waiting callers receive the same result

On error:

- Nothing is cached
- All waiting callers receive the same error
- `onError` is called exactly once
- Existing cache entries for the key are invalidated

## Write / Invalidate

```ts
cache("users").invalidate();
```

- Clears all cached entries for the key
- Clears in-flight state
- Does **not** remove the key definition

Invalidate is **logical**, not destructive.

## TTL & Garbage Collection

TTL is enforced per entry and is **absolute**, not sliding.

```ts
cache.gc(); // all keys
cache.gc("users"); // single key
```

- TTL starts once after a successful `fn` call
- Hits do not extend TTL
- Expired entries are ignored on access
- Expired entries are removed only when `gc()` is called
- No background timers

## Stats

```ts
const stats = cache.stats("users");
```

Returned metrics:

```ts
{
  hits: number;
  misses: number;
  errors: number;
  entries: number;
  inFlight: number;
}
```

Stats are best-effort monitoring, not accounting.

## Error Semantics

- Errors are never cached
- Errors invalidate existing entries for the key
- Errors propagate to all concurrent callers
- Cache remains usable after failure

## FAQ

### Does the cache store one value per key or per call?

Per **key + normalized arguments**.

Each cache key can hold multiple entries:

```
(key + args) → result
```

Different arguments always create separate cache entries.

### How are arguments normalized?

Arguments are normalized using:

```ts
JSON.stringify(args);
```

The resulting string is used as the lookup key.

- Same string → same cache entry
- Different string → different entry
- Object key order matters
- No deep or semantic equality
- Non-serializable values are not supported

### What happens if object keys are in a different order?

They are treated as **different arguments**.

```ts
{ a: 1, b: 2 } !== { b: 2, a: 1 }
```

This is intentional. The cache compares strings, not meaning.

### How does TTL work?

TTL is absolute.

After a successful call to `fn`:

```
expires = Date.now() + ttl
```

- TTL starts once
- Hits do not extend TTL
- In-flight waiters do not affect TTL

### Why no sliding TTL?

By design.

- Sliding TTL hides behavior
- Hot keys may never expire
- Harder to reason about

Fixed TTL is deterministic and predictable.

### When is cache data removed?

In two ways:

1. **Logically**
   Expired entries are ignored on access.

2. **Physically**
   `gc()` removes expired entries from memory.

There are no background timers.

### What does `gc()` do?

Only this:

- Deletes expired entries
- Frees memory

It does not refresh TTL, evict valid entries, touch in-flight calls, or affect stats.

### What happens on errors?

- Errors are not cached
- All concurrent callers receive the same error
- `onError` is called once
- Existing entries for the key are invalidated
- The cache remains usable

### Is `ttl: Infinity` allowed?

Yes.

- Entries never expire
- GC will not remove them
- Invalidation must be explicit

Use only with bounded key space.

### Why does the API use `createCache()`?

`createCache()` is used so the cache itself is directly callable.
This keeps the common case (`cache(key).call(...)`) simple and avoids extra method indirection.
