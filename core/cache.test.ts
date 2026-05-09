import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Cache } from "./cache";

describe("Cache", () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache();
  });

  test("returns cached promise for same key", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;
      return 123;
    };

    const [a, b, c] = await Promise.all([
      cache.get("x", fn),
      cache.get("x", fn),
      cache.get("x", fn),
    ]);

    expect(a).toBe(123);
    expect(b).toBe(123);
    expect(c).toBe(123);

    expect(calls).toBe(1);
  });

  test("creates new request after ttl expires", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;
      return calls;
    };

    const a = await cache.get("x", fn, 10);

    await Bun.sleep(20);

    const b = await cache.get("x", fn, 10);

    expect(a).toBe(1);
    expect(b).toBe(2);

    expect(calls).toBe(2);
  });

  test("keeps cache alive within ttl", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;
      return calls;
    };

    const a = await cache.get("x", fn, 1000);
    const b = await cache.get("x", fn, 1000);

    expect(a).toBe(1);
    expect(b).toBe(1);

    expect(calls).toBe(1);
  });

  test("removes rejected promises from cache", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;
      throw new Error("boom");
    };

    await expect(cache.get("x", fn)).rejects.toThrow("boom");
    await expect(cache.get("x", fn)).rejects.toThrow("boom");

    expect(calls).toBe(2);
  });

  test("does not delete newer promise when older one rejects", async () => {
    let rejectOld!: (err: Error) => void;

    const oldPromise = new Promise<number>((_, reject) => {
      rejectOld = reject;
    });

    let newCalls = 0;

    const oldFn = () => oldPromise;

    const newFn = async () => {
      newCalls++;
      return 999;
    };

    const first = cache.get("x", oldFn, 1);

    await Bun.sleep(10);

    const second = cache.get("x", newFn, 1000);

    rejectOld(new Error("old failed"));

    await expect(first).rejects.toThrow("old failed");

    await expect(second).resolves.toBe(999);

    const third = await cache.get("x", newFn, 1000);

    expect(third).toBe(999);
    expect(newCalls).toBe(1);
  });

  test("supports Infinity ttl", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;
      return calls;
    };

    const a = await cache.get("x", fn);
    await Bun.sleep(20);
    const b = await cache.get("x", fn);

    expect(a).toBe(1);
    expect(b).toBe(1);

    expect(calls).toBe(1);
  });

  test("clear removes everything", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;
      return calls;
    };

    await cache.get("x", fn);

    cache.clear();

    const result = await cache.get("x", fn);

    expect(result).toBe(2);
    expect(calls).toBe(2);
  });

  test("handles massive concurrency correctly", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;

      await Bun.sleep(10);

      return "ok";
    };

    const results = await Promise.all(
      Array.from({ length: 10_000 }, () => cache.get("hot-key", fn)),
    );

    expect(new Set(results).size).toBe(1);
    expect(calls).toBe(1);
  });

  test("handles many unique keys", async () => {
    const results = await Promise.all(
      Array.from({ length: 5000 }, (_, i) => cache.get(`k${i}`, async () => i)),
    );

    expect(results).toHaveLength(5000);

    for (let i = 0; i < results.length; i++) {
      expect(results[i]).toBe(i);
    }
  });

  test("cleanup removes expired entries", async () => {
    const fn = async () => 1;

    await cache.get("a", fn, 1);
    await cache.get("b", fn, 1);

    await Bun.sleep(10);

    // trigger cleanup cycle
    for (let i = 0; i < 1000; i++) {
      await cache.get(`x${i}`, async () => i, 1);
    }

    const store = (cache as any).store as Map<string, unknown>;

    expect(store.has("a")).toBe(false);
    expect(store.has("b")).toBe(false);
  });

  test("survives repeated rapid expiration churn", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;
      return calls;
    };

    for (let i = 0; i < 500; i++) {
      await cache.get("x", fn, 1);
      await Bun.sleep(2);
    }

    expect(calls).toBeGreaterThan(100);
  });

  test("sync throw is converted into rejected promise", async () => {
    const fn = () => {
      throw new Error("sync");
    };

    await expect(cache.get("x", fn)).rejects.toThrow("sync");
  });

  test("parallel expired requests collapse correctly", async () => {
    let calls = 0;

    const fn = async () => {
      calls++;

      await Bun.sleep(5);

      return calls;
    };

    await cache.get("x", fn, 1);

    await Bun.sleep(10);

    const [a, b, c] = await Promise.all([
      cache.get("x", fn, 100),
      cache.get("x", fn, 100),
      cache.get("x", fn, 100),
    ]);

    expect(a).toBe(2);
    expect(b).toBe(2);
    expect(c).toBe(2);

    expect(calls).toBe(2);
  });
});
