import type { z } from "zod";
import { systemClock, type Clock } from "./clock";
import { ConcurrencyBusyError, createConcurrencyLimiter } from "./concurrency";
import { candlesSchema, eventSchema, eventsPageSchema, orderBookSchema, pubtickerSchema, recentTradesSchema } from "./schema";
import { fail, ok, type MarketsResult } from "./result";
import { parseInstrumentSymbol } from "./symbol";
import { createTtlCache } from "./ttl-cache";
import type { Candle, CandleTimeframe, EventsPage, MarketEvent, OrderBook, RecentTrade, SpotTicker } from "./types";

const CACHE_TTL_MS = 5_000;
const EVENTS_CACHE_TTL_MS = 20_000;
const CANDLES_CACHE_TTL_MS = 60_000;
const PUBTICKER_CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_IN_FLIGHT = 4;
const MAX_QUEUED_REQUESTS = 24;
const MAX_CACHED_RESPONSES = 200;
const DEFAULT_LIMIT = 20;
const DEFAULT_TRADE_LIMIT = 30;
const MAX_RETRIES = 3;

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
  readonly pubticker: (pair: string) => Promise<MarketsResult<SpotTicker>>;
}

export interface GeminiMarketsClientOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  readonly clock?: Clock;
  readonly maxInFlight?: number;
  readonly minRequestIntervalMs?: number;
}

function retryAfterMs(header: string | null, attempt: number): number {
  if (header !== null && header.trim() !== "") {
    const asNumber = Number(header);
    if (Number.isFinite(asNumber) && asNumber >= 0) return Math.min(asNumber * 1000, 10_000);
    const asDate = Date.parse(header);
    if (Number.isFinite(asDate)) return Math.min(Math.max(asDate - Date.now(), 0), 10_000);
  }
  return Math.min(250 * 2 ** attempt, 4_000);
}

export function createGeminiMarketsClient(options: GeminiMarketsClientOptions): GeminiMarketsClient {
  const clock = options.clock ?? systemClock;
  const gate = createConcurrencyLimiter(options.maxInFlight ?? MAX_IN_FLIGHT, MAX_QUEUED_REQUESTS);
  const cache = createTtlCache<unknown>(clock, CACHE_TTL_MS, MAX_CACHED_RESPONSES);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const inFlight = new Map<string, Promise<MarketsResult<unknown>>>();
  let nextSlotMs = 0;
  const minIntervalMs = options.minRequestIntervalMs ?? 0;

  function cacheTtlFor(url: string): number {
    if (url.includes("/v1/pubticker/")) return PUBTICKER_CACHE_TTL_MS;
    if (url.includes("/v2/candles/")) return CANDLES_CACHE_TTL_MS;
    if (url.includes("/v1/prediction-markets/events")) return EVENTS_CACHE_TTL_MS;
    return CACHE_TTL_MS;
  }

  function staleOk<S extends z.ZodType>(url: string): MarketsResult<z.output<S>> | undefined {
    const stale = cache.getStale(url);
    return stale === undefined ? undefined : ok(stale as z.output<S>);
  }

  function getJson<S extends z.ZodType>(url: string, schema: S, refresh = false): Promise<MarketsResult<z.output<S>>> {
    if (!refresh) {
      const cached = cache.get(url);
      if (cached !== undefined) return Promise.resolve(ok(cached as z.output<S>));
    }
    const pending = inFlight.get(url);
    if (pending) return pending as Promise<MarketsResult<z.output<S>>>;
    const request = fetchJson(url, schema).finally(() => inFlight.delete(url));
    inFlight.set(url, request);
    return request;
  }

  async function spacedGate<T>(task: () => Promise<T>): Promise<T> {
    if (minIntervalMs > 0) {
      const now = clock.nowMs();
      const startAt = Math.max(now, nextSlotMs);
      nextSlotMs = startAt + minIntervalMs;
      if (startAt > now) await clock.sleep(startAt - now);
    }
    return gate(task);
  }

  async function fetchJson<S extends z.ZodType>(url: string, schema: S): Promise<MarketsResult<z.output<S>>> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      let response: Response;
      try {
        const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        response = await spacedGate(() => options.fetch(url, { headers: { accept: "application/json" }, signal }));
      } catch (error) {
        const stale = staleOk<S>(url);
        if (stale) return stale;
        return fail(error instanceof ConcurrencyBusyError ? { kind: "busy" } : { kind: "network" });
      }
      if (response.status === 429) {
        if (attempt + 1 >= MAX_RETRIES) {
          const stale = staleOk<S>(url);
          if (stale) return stale;
          return fail({ kind: "http", status: 429 });
        }
        await clock.sleep(retryAfterMs(response.headers.get("retry-after"), attempt));
        continue;
      }
      if (!response.ok) {
        const stale = staleOk<S>(url);
        if (stale && response.status >= 500) return stale;
        return fail({ kind: "http", status: response.status });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        const stale = staleOk<S>(url);
        if (stale) return stale;
        return fail({ kind: "parse" });
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        const stale = staleOk<S>(url);
        if (stale) return stale;
        return fail({ kind: "parse" });
      }
      cache.set(url, parsed.data, cacheTtlFor(url));
      return ok(parsed.data);
    }
    const stale = staleOk<S>(url);
    if (stale) return stale;
    return fail({ kind: "network" });
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
      if (query.offset !== undefined) params.set("offset", String(query.offset));
      if (query.search !== undefined) params.set("search", query.search);
      if (query.category !== undefined) params.set("category", query.category);
      return getJson(`${baseUrl}/v1/prediction-markets/events?${params.toString()}`, eventsPageSchema);
    },
    getEvent,
    candles: (symbol, timeframe) =>
      withKnownContract(symbol, () => getJson(`${baseUrl}/v2/candles/${encodeURIComponent(symbol)}/${timeframe}`, candlesSchema)),
    orderBook: (symbol) => withKnownContract(symbol, () => getJson(`${baseUrl}/v1/book/${encodeURIComponent(symbol)}`, orderBookSchema)),
    recentTrades: (symbol, limit = DEFAULT_TRADE_LIMIT) =>
      withKnownContract(symbol, () => getJson(`${baseUrl}/v1/trades/${encodeURIComponent(symbol)}?limit_trades=${String(limit)}`, recentTradesSchema)),
    pubticker: (pair) => getJson(`${baseUrl}/v1/pubticker/${encodeURIComponent(pair.toLowerCase())}`, pubtickerSchema),
  };
}
