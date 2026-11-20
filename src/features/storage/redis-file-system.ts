import { basename } from "node:path";
import type { Redis } from "@upstash/redis";
import type { FileSystem } from "./file-system";

export interface RedisFileSystem extends FileSystem {
  readonly currentRevision: () => Promise<number>;
  readonly ownWrites: () => number;
}

export function createRedisFileSystem(redis: Pick<Redis, "get" | "set" | "incr">, prefix: string): RedisFileSystem {
  const namespace = prefix.trim().replace(/^:+|:+$/g, "");
  if (namespace.length === 0) throw new Error("Redis storage prefix is required");
  const revisionKey = `${namespace}:rev`;
  let writes = 0;

  function key(path: string): string {
    return `${namespace}:${basename(path.replaceAll("\\", "/"))}`;
  }

  async function write(path: string, contents: string): Promise<void> {
    await redis.set(key(path), contents);
    await redis.incr(revisionKey);
    writes += 1;
  }

  return {
    async readText(path) {
      const contents = await redis.get<string>(key(path));
      return contents ?? undefined;
    },
    writeTextAtomic: write,
    async preserveCopy(path, preservedPath) {
      const contents = await redis.get<string>(key(path));
      if (contents !== null) await write(preservedPath, contents);
    },
    async currentRevision() {
      const revision = await redis.get<number | string>(revisionKey);
      if (typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0) return revision;
      if (typeof revision === "string" && /^\d+$/.test(revision)) return Number(revision);
      return 0;
    },
    ownWrites: () => writes,
  };
}
