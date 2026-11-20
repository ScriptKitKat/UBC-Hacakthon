import type { Redis } from "@upstash/redis";
import { expect, it } from "vitest";
import { StoreConflictError } from "./json-store";
import { nodeFileSystem } from "./file-system";
import { resolveFileSystem } from "./resolve-file-system";
import { createRedisFileSystem } from "./redis-file-system";

function fakeRedis(): { readonly client: Pick<Redis, "get" | "mget" | "eval">; readonly values: Map<string, string | number> } {
  const values = new Map<string, string | number>();
  const client = {
    get: (key: string) => Promise.resolve(values.get(key) ?? null),
    mget: (...args: string[] | [string[]]) => {
      const keys: string[] = args.length === 1 && Array.isArray(args[0]) ? args[0] : args as string[];
      return Promise.resolve(keys.map((key) => values.get(key) ?? null));
    },
    eval: (_script: string, keys: string[], args: unknown[]) => {
      const [fileKey, versionKey, revisionKey] = keys;
      const valuesToWrite = args as string[];
      const current = Number(values.get(versionKey ?? "") ?? 0);
      if (current !== Number(valuesToWrite[0])) return Promise.resolve(0);
      const next = current + 1;
      values.set(fileKey ?? "", valuesToWrite[1] ?? "");
      values.set(versionKey ?? "", next);
      values.set(revisionKey ?? "", Number(values.get(revisionKey ?? "") ?? 0) + 1);
      return Promise.resolve(next);
    },
  } as unknown as Pick<Redis, "get" | "mget" | "eval">;
  return {
    values,
    client,
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

it("allows sequential writes by one instance", async () => {
  const { client, values } = fakeRedis();
  const fs = createRedisFileSystem(client, "desk");
  await fs.readText("/data/agents.json");
  await fs.writeTextAtomic("/data/agents.json", "first");
  await fs.writeTextAtomic("/data/agents.json", "second");
  await expect(fs.readText("/data/agents.json")).resolves.toBe("second");
  expect(values.get("desk:agents.json:v")).toBe(2);
  expect(values.get("desk:rev")).toBe(2);
});

it("rejects a stale concurrent write without overwriting the newer value", async () => {
  const { client, values } = fakeRedis();
  const first = createRedisFileSystem(client, "desk");
  const second = createRedisFileSystem(client, "desk");
  await Promise.all([first.readText("/data/agents.json"), second.readText("/data/agents.json")]);
  await first.writeTextAtomic("/data/agents.json", "newer");
  await expect(second.writeTextAtomic("/data/agents.json", "stale")).rejects.toBeInstanceOf(StoreConflictError);
  await expect(first.readText("/data/agents.json")).resolves.toBe("newer");
  expect(values.get("desk:rev")).toBe(1);
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
