import { describe, it, expect } from "bun:test";
import { cache } from "./cache";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const key = (name: string) => `${name}:${crypto.randomUUID()}`;

describe("cache", () => {
  it("should cache by key", async () => {
    const k = key("cache-by-key");

    let calls = 0;

    const a = await cache(
      async () => {
        calls++;
        return "ok";
      },
      {
        key: k,
        ttl: 1000,
      },
    );

    const b = await cache(
      async () => {
        calls++;
        return "nope";
      },
      {
        key: k,
        ttl: 1000,
      },
    );

    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(calls).toBe(1);
  });

  it("should isolate different keys", async () => {
    let calls = 0;

    const a = await cache(
      async () => {
        calls++;
        return "users";
      },
      {
        key: key("users"),
        ttl: 1000,
      },
    );

    const b = await cache(
      async () => {
        calls++;
        return "orders";
      },
      {
        key: key("orders"),
        ttl: 1000,
      },
    );

    expect(a).toBe("users");
    expect(b).toBe("orders");
    expect(calls).toBe(2);
  });

  it("should expire entries via ttl", async () => {
    const k = key("ttl");

    let calls = 0;

    const a = await cache(
      async () => {
        calls++;
        return calls;
      },
      {
        key: k,
        ttl: 5,
      },
    );

    await sleep(15);

    const b = await cache(
      async () => {
        calls++;
        return calls;
      },
      {
        key: k,
        ttl: 5,
      },
    );

    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(calls).toBe(2);
  });

  it("should support ttl=Infinity", async () => {
    const k = key("infinity");

    let calls = 0;

    const a = await cache(
      async () => {
        calls++;
        return calls;
      },
      {
        key: k,
        ttl: Infinity,
      },
    );

    await sleep(10);

    const b = await cache(
      async () => {
        calls++;
        return calls;
      },
      {
        key: k,
        ttl: Infinity,
      },
    );

    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
  });

  it("should not cache when ttl=0", async () => {
    const k = key("no-cache");

    let calls = 0;

    const a = await cache(
      async () => {
        calls++;
        return calls;
      },
      {
        key: k,
        ttl: 0,
      },
    );

    const b = await cache(
      async () => {
        calls++;
        return calls;
      },
      {
        key: k,
        ttl: 0,
      },
    );

    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(calls).toBe(2);
  });

  it("should deduplicate in-flight calls", async () => {
    const k = key("dedupe");

    let calls = 0;

    const results = await Promise.all([
      cache(
        async () => {
          calls++;
          await sleep(10);
          return "ok";
        },
        {
          key: k,
          ttl: 1000,
        },
      ),

      cache(
        async () => {
          calls++;
          return "nope";
        },
        {
          key: k,
          ttl: 1000,
        },
      ),

      cache(
        async () => {
          calls++;
          return "also-nope";
        },
        {
          key: k,
          ttl: 1000,
        },
      ),
    ]);

    expect(results).toEqual(["ok", "ok", "ok"]);
    expect(calls).toBe(1);
  });

  it("should deduplicate in-flight calls even with ttl=0", async () => {
    const k = key("dedupe-no-cache");

    let calls = 0;

    const results = await Promise.all([
      cache(
        async () => {
          calls++;
          await sleep(10);
          return "ok";
        },
        {
          key: k,
          ttl: 0,
        },
      ),

      cache(
        async () => {
          calls++;
          return "nope";
        },
        {
          key: k,
          ttl: 0,
        },
      ),
    ]);

    expect(results).toEqual(["ok", "ok"]);
    expect(calls).toBe(1);

    await cache(
      async () => {
        calls++;
        return "fresh";
      },
      {
        key: k,
        ttl: 0,
      },
    );

    expect(calls).toBe(2);
  });

  it("should propagate in-flight errors to all waiters", async () => {
    const k = key("error-fanout");

    let calls = 0;

    const tasks = Promise.all([
      cache(
        async () => {
          calls++;
          await sleep(10);
          throw new Error("boom");
        },
        {
          key: k,
          ttl: 1000,
        },
      ),

      cache(
        async () => {
          calls++;
          return "nope";
        },
        {
          key: k,
          ttl: 1000,
        },
      ),

      cache(
        async () => {
          calls++;
          return "also-nope";
        },
        {
          key: k,
          ttl: 1000,
        },
      ),
    ]);

    await expect(tasks).rejects.toThrow("boom");

    expect(calls).toBe(1);
  });

  it("should never cache errors", async () => {
    const k = key("no-error-cache");

    let calls = 0;

    await expect(
      cache(
        async () => {
          calls++;
          throw new Error(`boom-${calls}`);
        },
        {
          key: k,
          ttl: 1000,
        },
      ),
    ).rejects.toThrow("boom-1");

    await expect(
      cache(
        async () => {
          calls++;
          throw new Error(`boom-${calls}`);
        },
        {
          key: k,
          ttl: 1000,
        },
      ),
    ).rejects.toThrow("boom-2");

    expect(calls).toBe(2);
  });

  it("should recover after failure", async () => {
    const k = key("recover");

    let calls = 0;

    await expect(
      cache(
        async () => {
          calls++;

          if (calls === 1) {
            throw new Error("boom");
          }

          return "ok";
        },
        {
          key: k,
          ttl: 1000,
        },
      ),
    ).rejects.toThrow("boom");

    const result = await cache(
      async () => {
        calls++;
        return "ok";
      },
      {
        key: k,
        ttl: 1000,
      },
    );

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("should not deadlock after rejection", async () => {
    const k = key("deadlock");

    let calls = 0;

    await Promise.allSettled([
      cache(
        async () => {
          calls++;
          await sleep(5);
          throw new Error("boom");
        },
        {
          key: k,
          ttl: 1000,
        },
      ),

      cache(
        async () => {
          calls++;
          return "x";
        },
        {
          key: k,
          ttl: 1000,
        },
      ),
    ]);

    const value = await cache(
      async () => {
        calls++;
        return "recovered";
      },
      {
        key: k,
        ttl: 1000,
      },
    );

    expect(value).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("should survive heavy concurrency", async () => {
    let calls = 0;

    const tasks: Promise<any>[] = [];

    for (let i = 0; i < 1000; i++) {
      const id = i % 20;

      tasks.push(
        cache(
          async () => {
            calls++;

            await sleep(Math.floor(Math.random() * 5));

            if (id % 10 === 0) {
              throw new Error("boom");
            }

            return id;
          },
          {
            key: `stress:${id}`,
            ttl: 20,
          },
        ).catch(() => null),
      );
    }

    const results = await Promise.all(tasks);

    for (let i = 0; i < results.length; i++) {
      const id = i % 20;

      if (id % 10 === 0) {
        expect(results[i]).toBeNull();
      } else {
        expect(results[i]).toBe(id);
      }
    }

    // must be massively below 1000 if dedupe works
    expect(calls).toBeLessThan(300);
  });

  it("should refresh after ttl expiry under concurrency", async () => {
    const k = key("refresh");

    let value = 0;

    const first = await cache(
      async () => {
        await sleep(2);
        return ++value;
      },
      {
        key: k,
        ttl: 5,
      },
    );

    await sleep(15);

    const results = await Promise.all([
      cache(
        async () => {
          await sleep(2);
          return ++value;
        },
        {
          key: k,
          ttl: 5,
        },
      ),

      cache(async () => 999, {
        key: k,
        ttl: 5,
      }),

      cache(async () => 999, {
        key: k,
        ttl: 5,
      }),
    ]);

    expect(results[0]).toBeGreaterThan(first);
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });
});
