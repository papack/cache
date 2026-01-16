import { describe, it, expect } from "bun:test";
import { createCache } from "./cache";

type Keys = "users" | "orders";

describe("cache contract", () => {
  it("should enforce init-before-call at runtime", async () => {
    const cache = createCache<Keys>();

    await expect(cache("users").call({ any: true })).rejects.toThrow(
      /not initialized/i,
    );
  });

  it("should register exactly once per key", () => {
    const cache = createCache<Keys>();

    cache("users").init({
      ttl: 1000,
      fn: async () => "ok",
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    expect(() =>
      cache("users").init({
        ttl: 1000,
        fn: async () => "nope",
        onHit: () => {},
        onMiss: () => {},
        onError: () => {},
      }),
    ).toThrow(/already initialized/i);
  });

  it("should cache per normalized args", async () => {
    const cache = createCache<Keys>();
    let calls = 0;

    cache("users").init({
      ttl: 1000,
      fn: async (args: { id: number }) => {
        calls++;
        return args.id;
      },
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    const a = await cache("users").call({ id: 1 });
    const b = await cache("users").call({ id: 1 });
    const c = await cache("users").call({ id: 2 });

    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(2);
    expect(calls).toBe(2); // id=1 once, id=2 once
  });

  it("should invalidate logically", async () => {
    const cache = createCache<Keys>();
    let calls = 0;

    cache("users").init({
      ttl: 1000,
      fn: async () => ++calls,
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    const a = await cache("users").call({});
    cache("users").invalidate();
    const b = await cache("users").call({});

    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it("should recover after async error and allow new calls", async () => {
    const cache = createCache<Keys>();
    let calls = 0;

    cache("users").init({
      ttl: 1000,
      fn: async () => {
        calls++;
        if (calls === 1) throw new Error("boom");
        return "ok";
      },
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    await expect(cache("users").call({})).rejects.toThrow("boom");

    const result = await cache("users").call({});
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("should expire entries via ttl + gc", async () => {
    const cache = createCache<Keys>();

    cache("users").init({
      ttl: 1,
      fn: async () => "x",
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    await cache("users").call({});
    await new Promise((r) => setTimeout(r, 5));

    cache.gc("users");
    const stats = cache.stats("users");

    expect(stats.entries).toBe(0);
  });

  it("should deduplicate in-flight calls (stampede protection)", async () => {
    const cache = createCache<Keys>();
    let calls = 0;

    cache("users").init({
      ttl: 1000,
      fn: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return "ok";
      },
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    const results = await Promise.all([
      cache("users").call({}),
      cache("users").call({}),
      cache("users").call({}),
    ]);

    expect(results).toEqual(["ok", "ok", "ok"]);
    expect(calls).toBe(1);
  });

  it("should invalidate and propagate error on failure", async () => {
    const cache = createCache<Keys>();
    let errors = 0;

    cache("users").init({
      ttl: 1000,
      fn: async () => {
        throw new Error("boom");
      },
      onHit: () => {},
      onMiss: () => {},
      onError: () => {
        errors++;
      },
    });

    const calls = Promise.all([
      cache("users").call({}),
      cache("users").call({}),
    ]);

    await expect(calls).rejects.toThrow("boom");

    const stats = cache.stats("users");
    expect(stats.entries).toBe(0);
    expect(errors).toBe(1);
  });

  it("should expose correct stats", async () => {
    const cache = createCache<Keys>();

    cache("users").init({
      ttl: 1000,
      fn: async () => "x",
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    await cache("users").call({});
    await cache("users").call({});

    const stats = cache.stats("users");

    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.errors).toBe(0);
    expect(stats.entries).toBe(1);
    expect(stats.inFlight).toBe(0);
  });
});

describe("cache stress / edge cases", () => {
  it("should remain consistent under heavy concurrent load", async () => {
    const cache = createCache<Keys>();

    let calls = 0;
    let errors = 0;

    cache("users").init({
      ttl: 20,
      fn: async ({ id }: { id: number }) => {
        calls++;

        // introduce jitter + occasional failure
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));

        if (id % 10 === 0) {
          throw new Error("random failure");
        }

        return id;
      },
      onHit: () => {},
      onMiss: () => {},
      onError: () => {
        errors++;
      },
    });

    const tasks: Promise<any>[] = [];

    // 1000 concurrent calls, overlapping args, mixed failures
    for (let i = 0; i < 1000; i++) {
      const id = i % 20; // force collisions
      tasks.push(
        cache("users")
          .call({ id })
          .catch(() => null),
      );
    }

    const results = await Promise.all(tasks);

    // All non-failing ids should resolve correctly
    for (let i = 0; i < results.length; i++) {
      const id = i % 20;
      if (id % 10 === 0) {
        expect(results[i]).toBeNull();
      } else {
        expect(results[i]).toBe(id);
      }
    }

    const stats = cache.stats("users");

    // Hard invariants
    expect(stats.inFlight).toBe(0); // no leaked promises
    expect(stats.entries).toBeLessThanOrEqual(20);
    expect(stats.errors).toBe(errors);

    // Calls should be bounded (stampede protection works)
    expect(calls).toBeLessThan(300); // << 1000
  });

  it("should not return stale data after ttl under concurrency", async () => {
    const cache = createCache<Keys>();
    let value = 0;

    cache("users").init({
      ttl: 10,
      fn: async () => {
        await new Promise((r) => setTimeout(r, 2));
        return ++value;
      },
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    const first = (await cache("users").call({})) as number;
    await new Promise((r) => setTimeout(r, 15));

    const results = await Promise.all([
      cache("users").call({}),
      cache("users").call({}),
      cache("users").call({}),
    ]);

    // all should see the same fresh value
    expect(results[0]).toBeGreaterThan(first);
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  it("should not deadlock if invalidate is called during in-flight", async () => {
    const cache = createCache<Keys>();
    let calls = 0;

    let release: () => void;
    const gate = new Promise<void>((r) => (release = r));

    cache("users").init({
      ttl: 1000,
      fn: async () => {
        calls++;
        await gate;
        return "ok";
      },
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    const p1 = cache("users").call({});
    const p2 = cache("users").call({});

    cache("users").invalidate(); // invalidate while in-flight
    release!();

    const results = await Promise.all([p1, p2]);

    expect(results).toEqual(["ok", "ok"]);
    expect(calls).toBe(1);

    const stats = cache.stats("users");
    expect(stats.inFlight).toBe(0);
  });
  it("should count hits and misses correctly under in-flight concurrency", async () => {
    const cache = createCache<Keys>();

    cache("users").init({
      ttl: 1000,
      fn: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "ok";
      },
      onHit: () => {},
      onMiss: () => {},
      onError: () => {},
    });

    await Promise.all([
      cache("users").call({}),
      cache("users").call({}),
      cache("users").call({}),
    ]);

    const afterFirstWave = cache.stats("users");

    expect(afterFirstWave.misses).toBe(1);
    expect(afterFirstWave.hits).toBe(0);

    await cache("users").call({});
    await cache("users").call({});

    const afterHits = cache.stats("users");

    expect(afterHits.misses).toBe(1);
    expect(afterHits.hits).toBe(2);
  });
});
