import { basename } from "node:path";
import type { Redis } from "@upstash/redis";
import { StoreConflictError } from "./json-store";
import type { FileSystem } from "./file-system";

export interface RedisFileSystem extends FileSystem {
  readonly currentRevision: () => Promise<number>;
  readonly ownWrites: () => number;
}

const CAS_WRITE = "local version = tonumber(redis.call('GET', KEYS[2]) or '0') if version ~= tonumber(ARGV[1]) then return 0 end local nextVersion = version + 1 redis.call('SET', KEYS[1], ARGV[2]) redis.call('SET', KEYS[2], nextVersion) redis.call('INCR', KEYS[3]) return nextVersion";

export function createRedisFileSystem(redis: Pick<Redis, "get" | "mget" | "eval">, prefix: string): RedisFileSystem {
  const namespace = prefix.trim().replace(/^:+|:+$/g, "");
  if (namespace.length === 0) throw new Error("Redis storage prefix is required");
  const revisionKey = `${namespace}:rev`;
  let writes = 0;
  const versions = new Map<string, number>();

  function key(path: string): string {
    return `${namespace}:${basename(path.replaceAll("\\", "/"))}`;
  }

  async function read(path: string): Promise<string | undefined> {
    const fileKey = key(path);
    const [contents, rawVersion] = await redis.mget<[string | null, string | null]>(fileKey, `${fileKey}:v`);
    const version = rawVersion === null ? 0 : Number(rawVersion);
    if (!Number.isSafeInteger(version) || version < 0) throw new StoreConflictError(path);
    versions.set(fileKey, version);
    return contents ?? undefined;
  }

  async function write(path: string, contents: string): Promise<void> {
    const fileKey = key(path);
    const versionKey = `${fileKey}:v`;
    const expectedVersion = versions.get(fileKey) ?? 0;
    const nextVersion = await redis.eval<number>(
      CAS_WRITE,
      [fileKey, versionKey, revisionKey],
      [String(expectedVersion), contents],
    );
    if (!Number.isSafeInteger(nextVersion) || nextVersion <= expectedVersion) throw new StoreConflictError(path);
    versions.set(fileKey, nextVersion);
    writes += 1;
  }

  return {
    readText: read,
    writeTextAtomic: write,
    async preserveCopy(path, preservedPath) {
      const contents = await read(path);
      if (contents !== undefined) await write(preservedPath, contents);
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
