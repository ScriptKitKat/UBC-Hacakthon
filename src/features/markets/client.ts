import type { z } from "zod";
import { systemClock, type Clock } from "./clock";
import { createRateLimiter, RateLimiterBusyError } from "./rate-limiter";
import { candlesSchema, eventSchema, eventsPageSchema, orderBookSchema, recentTradesSchema } from "./schema";
import { fail, ok, type MarketsResult } from "./result";
import { parseInstrumentSymbol } from "./symbol";
import { createTtlCache } from "./ttl-cache";
import type { Candle, CandleTimeframe, EventsPage, MarketEvent, OrderBook, RecentTrade } from "./types";

const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1000;
const CACHE_TTL_MS = 5000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_QUEUED_REQUESTS = 12;
const MAX_CACHED_RESPONSES = 200;
const DEFAULT_LIMIT = 20;
const DEFAULT_TRADE_LIMIT = 30;

export interface SearchEventsQuery {
  readonly search?: string;
  readonly category?: string;
  readonly status?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface GeminiMarketsClient {
  readonly searchEvents: (query?: SearchEventsQuery) => Promise<MarketsResult<EventsPage>>;
  readonly getEvent: (ticker: string, options?: { readonly refresh?: boolean }) => Promise<MarketsResult<MarketEvent>>;
  readonly candles: (symbol: string, timeframe: CandleTimeframe) => Promise<MarketsResult<readonly Candle[]>>;
  readonly orderBook: (symbol: string) => Promise<MarketsResult<OrderBook>>;
  readonly recentTrades: (symbol: string, limit?: number) => Promise<MarketsResult<readonly RecentTrade[]>>;
}

export interface GeminiMarketsClientOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly clock?: Clock;
  readonly minRequestIntervalMs?: number;
}

export function createGeminiMarketsClient(options: GeminiMarketsClientOptions): GeminiMarketsClient {
  const clock = options.clock ?? systemClock;
  const limit = createRateLimiter(clock, options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS, MAX_QUEUED_REQUESTS);
  const cache = createTtlCache<unknown>(clock, CACHE_TTL_MS, MAX_CACHED_RESPONSES);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function getJson<S extends z.ZodType>(url: string, schema: S, refresh = false): Promise<MarketsResult<z.output<S>>> {
    const cached = refresh ? undefined : cache.get(url);
    if (cached !== undefined) {
      return ok(cached as z.output<S>);
    }
    let response: Response;
    try {
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      response = await limit(() => options.fetch(url, { headers: { accept: "application/json" }, signal }), signal);
    } catch (error) {
      return fail(error instanceof RateLimiterBusyError ? { kind: "busy" } : { kind: "network" });
    }
    if (!response.ok) return fail({ kind: "http", status: response.status });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fail({ kind: "parse" });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return fail({ kind: "parse" });
    }
    cache.set(url, parsed.data);
    return ok(parsed.data);
  }

  async function withKnownContract<T>(symbol: string, load: () => Promise<MarketsResult<T>>): Promise<MarketsResult<T>> {
    const parsed = parseInstrumentSymbol(symbol);
    if (!parsed) return fail({ kind: "http", status: 404 });
    const event = await getEvent(parsed.eventTicker);
    if (!event.ok) return event;
    if (!event.value.contracts.some((contract) => contract.instrumentSymbol === symbol)) return fail({ kind: "http", status: 404 });
    return load();
  }

  function getEvent(ticker: string, options?: { readonly refresh?: boolean }): Promise<MarketsResult<MarketEvent>> {
    return getJson(`${baseUrl}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`, eventSchema, options?.refresh);
  }

  return {
    searchEvents: (query = {}) => {
      const params = new URLSearchParams({
        status: query.status ?? "active",
        limit: String(query.limit ?? DEFAULT_LIMIT),
      });
      if (query.offset !== undefined) {
        params.set("offset", String(query.offset));
      }
      if (query.search !== undefined) {
        params.set("search", query.search);
      }
      if (query.category !== undefined) {
        params.set("category", query.category);
      }
      return getJson(`${baseUrl}/v1/prediction-markets/events?${params.toString()}`, eventsPageSchema);
    },
    getEvent,
    candles: (symbol, timeframe) =>
      withKnownContract(symbol, () => getJson(`${baseUrl}/v2/candles/${encodeURIComponent(symbol)}/${timeframe}`, candlesSchema)),
    orderBook: (symbol) => withKnownContract(symbol, () => getJson(`${baseUrl}/v1/book/${encodeURIComponent(symbol)}`, orderBookSchema)),
    recentTrades: (symbol, limit = DEFAULT_TRADE_LIMIT) =>
      withKnownContract(symbol, () => getJson(`${baseUrl}/v1/trades/${encodeURIComponent(symbol)}?limit_trades=${String(limit)}`, recentTradesSchema)),
  };
}
