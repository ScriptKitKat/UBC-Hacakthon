import { z } from "zod";
import type { XFeed, XSignals } from "./types";

const COUNT_ENDPOINT = "https://api.x.com/2/tweets/counts/recent";
const SEARCH_ENDPOINT = "https://api.x.com/2/tweets/search/recent";
const HOUR_MS = 60 * 60 * 1000;
const COUNT_BUCKET_SCHEMA = z.object({
  start: z.iso.datetime().optional(),
  end: z.iso.datetime().optional(),
  tweet_count: z.number().int().nonnegative(),
});
const COUNTS_RESPONSE_SCHEMA = z.object({ data: z.array(COUNT_BUCKET_SCHEMA) });
const POST_SCHEMA = z.object({
  id: z.string().min(1),
  text: z.string(),
  author_id: z.string().min(1),
  created_at: z.iso.datetime().optional(),
  public_metrics: z.object({
    retweet_count: z.number().int().nonnegative(),
    quote_count: z.number().int().nonnegative(),
    reply_count: z.number().int().nonnegative(),
  }),
});
const SEARCH_RESPONSE_SCHEMA = z.object({
  data: z.array(POST_SCHEMA).optional(),
  includes: z.object({
    users: z.array(z.object({ id: z.string().min(1), username: z.string().min(1) })).optional(),
  }).optional(),
}).superRefine((response, context) => {
  const userIds = new Set(response.includes?.users?.map((user) => user.id) ?? []);
  for (const post of response.data ?? []) {
    if (!userIds.has(post.author_id)) {
      context.addIssue({ code: "custom", path: ["includes", "users"], message: "Missing author username" });
    }
  }
});

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (sorted.length % 2 === 1) return upper ?? 0;
  return ((lower ?? 0) + (upper ?? 0)) / 2;
}

function countsUrl(query: string): URL {
  const url = new URL(COUNT_ENDPOINT);
  url.searchParams.set("query", `(${query}) -is:retweet`);
  url.searchParams.set("granularity", "hour");
  return url;
}

function searchUrl(query: string, now: Date): URL {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("query", `(${query}) is:verified -is:retweet -is:reply lang:en`);
  url.searchParams.set("start_time", new Date(now.getTime() - HOUR_MS).toISOString());
  url.searchParams.set("max_results", "10");
  url.searchParams.set("tweet.fields", "created_at,public_metrics,author_id");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username");
  return url;
}

async function responseJson(fetcher: typeof fetch, url: URL, bearerToken: string): Promise<unknown> {
  const response = await fetcher(url.toString(), {
    headers: { accept: "application/json", authorization: `Bearer ${bearerToken}` },
  });
  if (!response.ok) throw new Error("X API request failed");
  return response.json();
}

function breakingPost(raw: z.output<typeof SEARCH_RESPONSE_SCHEMA>): XSignals["breakingPost"] {
  const posts = raw.data ?? [];
  const best = posts
    .map((post, index) => ({
      post,
      index,
      engagement: post.public_metrics.retweet_count + post.public_metrics.quote_count + post.public_metrics.reply_count,
    }))
    .sort((left, right) => right.engagement - left.engagement || left.index - right.index)[0];
  if (best === undefined || best.engagement < 5) return null;
  const username = new Map((raw.includes?.users ?? []).map((user) => [user.id, user.username])).get(best.post.author_id);
  if (username === undefined) return null;
  return {
    id: best.post.id,
    text: best.post.text,
    authorUsername: username,
    url: `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(best.post.id)}`,
  };
}

async function loadCounts(fetcher: typeof fetch, bearerToken: string, query: string): Promise<XSignals["counts"]> {
  const counts = COUNTS_RESPONSE_SCHEMA.parse(await responseJson(fetcher, countsUrl(query), bearerToken));
  const ordered = [...counts.data].sort((left, right) => {
    if (left.start === undefined || right.start === undefined) return 0;
    return Date.parse(left.start) - Date.parse(right.start);
  });
  const complete = ordered.slice(0, -1);
  const last = complete.at(-1);
  if (last === undefined) return undefined;
  const previous = complete.slice(0, -1).slice(-24).map((bucket) => bucket.tweet_count);
  return {
    lastHourCount: last.tweet_count,
    baselineHourlyCount: median(previous),
  };
}

async function loadBreakingPost(fetcher: typeof fetch, bearerToken: string, query: string, now: Date): Promise<XSignals["breakingPost"]> {
  const search = SEARCH_RESPONSE_SCHEMA.parse(await responseJson(fetcher, searchUrl(query, now), bearerToken));
  return breakingPost(search);
}

interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly result: Promise<T>;
}

function cached<T>(
  cache: Map<string, CacheEntry<T>>,
  query: string,
  nowMs: number,
  cacheMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const existing = cache.get(query);
  if (existing !== undefined && existing.expiresAt > nowMs) return existing.result;
  const result = load();
  cache.set(query, { expiresAt: nowMs + cacheMs, result });
  return result;
}

export function createXFeed(options: {
  readonly bearerToken: string;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly cacheMs?: number;
}): XFeed {
  const cacheMs = options.cacheMs ?? 15 * 60_000;
  const countsCache = new Map<string, CacheEntry<XSignals["counts"]>>();
  const breakingCache = new Map<string, CacheEntry<XSignals["breakingPost"]>>();
  return {
    signals(query) {
      if (query.trim() === "") return Promise.resolve(undefined);
      const requestedAt = options.now();
      const nowMs = requestedAt.getTime();
      for (const [cachedQuery, entry] of countsCache) {
        if (entry.expiresAt <= nowMs) countsCache.delete(cachedQuery);
      }
      for (const [cachedQuery, entry] of breakingCache) {
        if (entry.expiresAt <= nowMs) breakingCache.delete(cachedQuery);
      }
      const counts = cached(countsCache, query, nowMs, cacheMs, () =>
        loadCounts(options.fetch, options.bearerToken, query).catch(() => undefined)
      );
      const breaking = cached(breakingCache, query, nowMs, cacheMs, () =>
        loadBreakingPost(options.fetch, options.bearerToken, query, requestedAt).catch(() => undefined)
      );
      return Promise.all([counts, breaking]).then(([countSignals, breakingPostSignal]) => ({
        counts: countSignals,
        breakingPost: breakingPostSignal,
      }));
    },
  };
}
