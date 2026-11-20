import { parseInstrumentSymbol } from "@/features/markets";
import { marketQuery } from "@/features/xfeed";
import type { XFeed, XPost } from "@/features/xfeed";
import type { ResearchPostContext } from "@/shared";
import { capChatter } from "./store";
import type { StoredChatter } from "./store";

const DEFAULT_TTL_MS = 60 * 60 * 1000;

export interface ChatterDeps {
  readonly xFeed: Pick<XFeed, "recentPosts">;
  readonly eventTitle: (eventTicker: string) => Promise<string | undefined>;
  readonly nowMs: () => number;
  readonly initialChatter?: readonly StoredChatter[];
  readonly saveChatter?: (events: readonly StoredChatter[]) => Promise<void>;
  readonly ttlMs?: number;
}

export interface Chatter {
  readonly load: (symbol: string) => Promise<readonly ResearchPostContext[]>;
  readonly peek: (symbol: string) => readonly ResearchPostContext[];
}

function searchedPost(post: XPost): ResearchPostContext {
  return { source: "x-search", text: post.text, author: `@${post.authorUsername}`, url: post.url, why: null, atMs: post.createdAtMs };
}

export function createChatter(deps: ChatterDeps): Chatter {
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
  const saveChatter = deps.saveChatter ?? (() => Promise.resolve());
  const cache = new Map((deps.initialChatter ?? []).map((entry) => [entry.eventTicker, entry]));
  const inFlight = new Map<string, Promise<readonly ResearchPostContext[]>>();

  function cachedPosts(eventTicker: string): readonly ResearchPostContext[] {
    return cache.get(eventTicker)?.posts ?? [];
  }

  async function search(eventTicker: string): Promise<readonly ResearchPostContext[]> {
    const title = await deps.eventTitle(eventTicker);
    if (title === undefined) return cachedPosts(eventTicker);
    const found = await deps.xFeed.recentPosts(marketQuery(title));
    if (found === undefined) return cachedPosts(eventTicker);
    const entry: StoredChatter = { eventTicker, fetchedAtMs: deps.nowMs(), posts: found.map(searchedPost) };
    cache.set(eventTicker, entry);
    const kept = capChatter([...cache.values()]);
    cache.clear();
    for (const item of kept) cache.set(item.eventTicker, item);
    saveChatter(kept).catch(() => undefined);
    return entry.posts;
  }

  return {
    load(symbol) {
      const eventTicker = parseInstrumentSymbol(symbol)?.eventTicker;
      if (eventTicker === undefined) return Promise.resolve([]);
      const hit = cache.get(eventTicker);
      if (hit !== undefined && deps.nowMs() - hit.fetchedAtMs < ttlMs) return Promise.resolve(hit.posts);
      const pending = inFlight.get(eventTicker);
      if (pending !== undefined) return pending;
      const request = search(eventTicker).finally(() => inFlight.delete(eventTicker));
      inFlight.set(eventTicker, request);
      return request;
    },
    peek(symbol) {
      const eventTicker = parseInstrumentSymbol(symbol)?.eventTicker;
      return eventTicker === undefined ? [] : cachedPosts(eventTicker);
    },
  };
}
