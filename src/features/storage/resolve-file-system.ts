import { Redis } from "@upstash/redis";
import { nodeFileSystem } from "./file-system";
import type { FileSystem } from "./file-system";
import { createRedisFileSystem } from "./redis-file-system";

export interface ResolvedFileSystem {
  readonly fs: FileSystem;
  readonly revision: {
    readonly current: () => Promise<number>;
    readonly ownWrites: () => number;
  } | undefined;
}

export function resolveFileSystem(env: Readonly<Record<string, string | undefined>>): ResolvedFileSystem {
  const upstashUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const marketplaceUrl = env.KV_REST_API_URL?.trim();
  const marketplaceToken = env.KV_REST_API_TOKEN?.trim();
  const url = upstashUrl && upstashToken ? upstashUrl : marketplaceUrl && marketplaceToken ? marketplaceUrl : undefined;
  const token = upstashUrl && upstashToken ? upstashToken : marketplaceUrl && marketplaceToken ? marketplaceToken : undefined;
  if (url === undefined || token === undefined) return { fs: nodeFileSystem, revision: undefined };

  const prefix = env.DESK_REDIS_PREFIX?.trim() || "desk";
  const redis = new Redis({ url, token, automaticDeserialization: false });
  const fs = createRedisFileSystem(redis, prefix);
  return {
    fs,
    revision: { current: fs.currentRevision, ownWrites: fs.ownWrites },
  };
}
