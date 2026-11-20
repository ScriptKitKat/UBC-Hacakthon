import type { Redis } from "@upstash/redis";
import { expect, it } from "vitest";
import { nodeFileSystem } from "./file-system";
import { resolveFileSystem } from "./resolve-file-system";
import { createRedisFileSystem } from "./redis-file-system";

function fakeRedis(): { readonly client: Pick<Redis, "get" | "set" | "incr">; readonly values: Map<string, string | number> } {
  const values = new Map<string, string | number>();
  return {
    values,
    client: {
      get<T>(key: string) {
        return Promise.resolve((values.get(key) as T | undefined) ?? null);
      },
      set(key: string, value: unknown) {
        values.set(key, value as string | number);
        return Promise.resolve("OK" as const);
      },
      incr(key: string) {
        const next = Number(values.get(key) ?? 0) + 1;
        values.set(key, next);
        return Promise.resolve(next);
      },
    },
  };
}

it("returns undefined when a Redis file is missing", async () => {
  const { client } = fakeRedis();
  const fs = createRedisFileSystem(client, "desk");
  await expect(fs.readText("/data/agents.json")).resolves.toBeUndefined();
});

it("round-trips file contents under prefix and basename keys and increments the revision", async () => {
  const { client, values } = fakeRedis();
  const fs = createRedisFileSystem(client, "desk:");
  await fs.writeTextAtomic("/data/agents.json", "{\"agents\":[]}");
  await expect(fs.readText("/other/agents.json")).resolves.toBe("{\"agents\":[]}");
  expect(values.get("desk:agents.json")).toBe("{\"agents\":[]}");
  expect(values.get("desk:rev")).toBe(1);
  expect(fs.ownWrites()).toBe(1);
  await expect(fs.currentRevision()).resolves.toBe(1);
});

it("preserves a copy of the file text", async () => {
  const { client, values } = fakeRedis();
  const fs = createRedisFileSystem(client, "desk");
  await fs.writeTextAtomic("/data/agents.json", "contents");
  await fs.preserveCopy("/data/agents.json", "/data/agents.json.corrupt-1");
  await expect(fs.readText("/data/agents.json.corrupt-1")).resolves.toBe("contents");
  expect(values.get("desk:rev")).toBe(2);
});

it("selects Redis from either credential pair and falls back to node storage", () => {
  const fallback = resolveFileSystem({});
  const upstash = resolveFileSystem({
    UPSTASH_REDIS_REST_URL: "https://upstash.example",
    UPSTASH_REDIS_REST_TOKEN: "upstash-token",
  });
  const marketplace = resolveFileSystem({
    KV_REST_API_URL: "https://marketplace.example",
    KV_REST_API_TOKEN: "marketplace-token",
  });
  expect(fallback.revision).toBeUndefined();
  expect(upstash.revision).toBeDefined();
  expect(marketplace.revision).toBeDefined();
  expect(fallback.fs).toBe(nodeFileSystem);
});
