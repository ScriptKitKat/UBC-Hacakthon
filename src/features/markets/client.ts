import type { z } from "zod";
import { systemClock, type Clock } from "./clock";
import { createRateLimiter } from "./rate-limiter";
import { eventSchema, eventsPageSchema } from "./schema";
import { fail, ok, type MarketsResult } from "./result";
import { createTtlCache } from "./ttl-cache";
import type { EventsPage, MarketEvent } from "./types";

const MIN_REQUEST_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 5000;
const DEFAULT_LIMIT = 20;

export interface SearchEventsQuery {
  readonly search?: string;
  readonly category?: string;
  readonly status?: string;
  readonly limit?: number;
}

export interface GeminiMarketsClient {
  readonly searchEvents: (query?: SearchEventsQuery) => Promise<MarketsResult<EventsPage>>;
  readonly getEvent: (ticker: string, options?: { readonly refresh?: boolean }) => Promise<MarketsResult<MarketEvent>>;
}

export interface GeminiMarketsClientOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly clock?: Clock;
}

export function createGeminiMarketsClient(options: GeminiMarketsClientOptions): GeminiMarketsClient {
  const clock = options.clock ?? systemClock;
  const limit = createRateLimiter(clock, MIN_REQUEST_INTERVAL_MS);
  const cache = createTtlCache<unknown>(clock, CACHE_TTL_MS);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function getJson<S extends z.ZodType>(url: string, schema: S, refresh = false): Promise<MarketsResult<z.output<S>>> {
    const cached = refresh ? undefined : cache.get(url);
    if (cached !== undefined) {
      return ok(cached as z.output<S>);
    }
    let response: Response;
    let body: unknown;
    try {
      response = await limit(() => options.fetch(url, { headers: { accept: "application/json" } }));
      if (!response.ok) {
        return fail({ kind: "http", status: response.status });
      }
      body = await response.json();
    } catch (error) {
      return fail({ kind: "network", message: error instanceof Error ? error.message : String(error) });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail({ kind: "parse", message: parsed.error.message });
    }
    cache.set(url, parsed.data);
    return ok(parsed.data);
  }

  return {
    searchEvents: (query = {}) => {
      const params = new URLSearchParams({
        status: query.status ?? "active",
        limit: String(query.limit ?? DEFAULT_LIMIT),
      });
      if (query.search !== undefined) {
        params.set("search", query.search);
      }
      if (query.category !== undefined) {
        params.set("category", query.category);
      }
      return getJson(`${baseUrl}/v1/prediction-markets/events?${params.toString()}`, eventsPageSchema);
    },
    getEvent: (ticker, options) =>
      getJson(`${baseUrl}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`, eventSchema, options?.refresh),
  };
}
