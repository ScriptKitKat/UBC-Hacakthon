import type { HistoryStore } from "@/features/history";
import type { LlmCompleter } from "@/features/llm";
import type { Candle, CandleTimeframe, GeminiMarketsClient, MarketContract, MarketEvent, MarketsError, MarketsResult, RecentTrade } from "@/features/markets";
import { parseInstrumentSymbol } from "@/features/markets";
import type { ResearchBrief, ResearchPostContext, ResearchRelatedContract, ResearchTimeframe, ResearchView } from "@/shared";
import { polishBrief } from "./brief";
import { composeLibraryBrief } from "./library-brief";
import { computeIndicators } from "./indicators";
import { ALL_CANDLE_TIMEFRAMES, CANDLE_INTERVAL_MS, cumulativeDepth, hourlyIndicatorPoints, INDICATOR_CANDLE, mergeSeries, TIMEFRAME_PLANS } from "./series";

const RELATED_EVENTS = 6;
const RELATED_SEARCH_LIMIT = 12;
const LAST_KNOWN_LIMIT = 50;
const TRADE_LIMIT = 30;
const TRADE_HISTORY_LIMIT = 500;
const TRADE_HISTORY_PAGES = 8;
const BRIEF_TIMEFRAME = "1D";

export type ResearchMarkets = Pick<GeminiMarketsClient, "getEvent" | "searchEvents" | "candles" | "orderBook" | "recentTrades">;

export interface ResearchDeps {
  readonly markets: ResearchMarkets;
  readonly history: HistoryStore;
  readonly nowMs: () => number;
  readonly postContextFor: (symbol: string) => Promise<ResearchPostContext | undefined>;
  readonly matchedPostsFor?: (symbol: string) => Promise<readonly ResearchPostContext[]>;
  readonly chatterFor?: (symbol: string) => readonly ResearchPostContext[];
  readonly llm?: LlmCompleter;
}

export type ResearchResult =
  | { readonly kind: "ok"; readonly view: ResearchView }
  | { readonly kind: "unknown-symbol" }
  | { readonly kind: "unavailable" };

export type BriefResult =
  | { readonly kind: "ok"; readonly template: ResearchBrief; readonly polished: () => Promise<ResearchBrief> }
  | { readonly kind: "unknown-symbol" }
  | { readonly kind: "unavailable" };

export interface Research {
  readonly view: (symbol: string, timeframe: ResearchTimeframe) => Promise<ResearchResult>;
  readonly brief: (symbol: string) => Promise<BriefResult>;
}

type MarketInfo = Pick<ResearchView, "market" | "related">;

interface EventAndContract {
  readonly event: MarketEvent;
  readonly contract: MarketContract;
}

function valueOr<T>(result: MarketsResult<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

function toRelated(event: MarketEvent, contract: MarketContract): ResearchRelatedContract {
  return {
    symbol: contract.instrumentSymbol,
    eventTitle: event.title,
    contractLabel: contract.label,
    yesCents: contract.prices.buyYesCents,
    noCents: contract.prices.buyNoCents,
  };
}

function leadContract(event: MarketEvent): MarketContract | undefined {
  return [...event.contracts]
    .filter((contract) => contract.marketState === "open" && contract.prices.buyYesCents !== null)
    .sort((a, b) => (b.prices.buyYesCents ?? 0) - (a.prices.buyYesCents ?? 0))[0];
}

function marketInfo({ event, contract }: EventAndContract, sameCategory: readonly ResearchRelatedContract[]): MarketInfo {
  return {
    market: {
      eventTicker: event.ticker,
      eventTitle: event.title,
      contractLabel: contract.label,
      category: event.category,
      subcategory: event.subcategory,
      expiryDate: contract.expiryDate ?? event.expiryDate,
      eventStatus: event.status,
      marketState: contract.marketState,
      rulesText: contract.description || event.description,
      imageUrl: event.imageUrl ?? null,
      termsLink: event.termsLink ?? null,
      volume: event.volume,
      volume24h: event.volume24h,
      quantityLimits: contract.limits
        ? {
            quantityIncrementHundredths: Number(contract.limits.quantityIncrementHundredths),
            quantityMinimumHundredths: Number(contract.limits.quantityMinimumHundredths),
          }
        : null,
      prices: {
        buyYesCents: contract.prices.buyYesCents,
        buyNoCents: contract.prices.buyNoCents,
        sellYesCents: contract.prices.sellYesCents,
        sellNoCents: contract.prices.sellNoCents,
        bestBidCents: contract.prices.bestBidCents,
        bestAskCents: contract.prices.bestAskCents,
        lastTradeCents: contract.prices.lastTradeCents,
      },
    },
    related: {
      sameEvent: event.contracts.filter((other) => other.instrumentSymbol !== contract.instrumentSymbol).map((other) => toRelated(event, other)),
      sameCategory: [...sameCategory],
    },
  };
}

function isNotFound(error: MarketsError): boolean {
  return error.kind === "http" && (error.status === 404 || error.status === 400);
}

function withTimestamp(post: ResearchPostContext | null): ResearchPostContext | null {
  if (post === null) return null;
  return { ...post, atMs: post.atMs ?? null };
}

function uniquePosts(posts: readonly ResearchPostContext[]): ResearchPostContext[] {
  const seen = new Set<string>();
  const unique: ResearchPostContext[] = [];
  for (const post of posts) {
    const key = post.url ?? post.text;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(post);
  }
  return unique;
}

async function loadBestCandles(
  request: (timeframe: CandleTimeframe) => ReturnType<ResearchMarkets["candles"]>,
  preferred: CandleTimeframe,
  windowMs: number | null,
  nowMs: number,
): Promise<{ readonly candles: readonly Candle[]; readonly timeframe: CandleTimeframe; readonly live: boolean }> {
  const earliest = windowMs === null ? Number.NEGATIVE_INFINITY : nowMs - windowMs;
  const inWindow = (rows: readonly Candle[]) => rows.filter((candle) => candle.timeMs >= earliest && candle.timeMs <= nowMs);
  const first = await request(preferred);
  const firstRows = first.ok ? first.value : [];
  if (inWindow(firstRows).length > 0) return { candles: firstRows, timeframe: preferred, live: true };
  for (const timeframe of ALL_CANDLE_TIMEFRAMES) {
    if (timeframe === preferred) continue;
    const next = await request(timeframe);
    const rows = next.ok ? next.value : [];
    if (inWindow(rows).length > 0) return { candles: rows, timeframe, live: true };
  }
  return { candles: [], timeframe: preferred, live: false };
}

async function loadTradeHistory(
  markets: ResearchMarkets,
  symbol: string,
  seed: readonly RecentTrade[],
): Promise<readonly RecentTrade[]> {
  const byId = new Map<number, RecentTrade>();
  const add = (rows: readonly RecentTrade[]) => {
    for (const row of rows) byId.set(row.tradeId, row);
  };
  add(seed);
  let sinceTid = 0;
  for (let page = 0; page < TRADE_HISTORY_PAGES; page += 1) {
    const result = await markets.recentTrades(symbol, TRADE_HISTORY_LIMIT, { sinceTid });
    if (!result.ok) break;
    if (result.value.length === 0) break;
    add(result.value);
    const last = result.value.reduce((max, trade) => Math.max(max, trade.tradeId), sinceTid);
    if (result.value.length < TRADE_HISTORY_LIMIT || last <= sinceTid) break;
    sinceTid = last;
  }
  return [...byId.values()].sort((left, right) => left.timeMs - right.timeMs);
}


export function createResearch(deps: ResearchDeps): Research {

  const { markets, history, nowMs } = deps;
  const lastKnown = new Map<string, MarketInfo>();

  function remember(symbol: string, info: MarketInfo): void {
    lastKnown.delete(symbol);
    lastKnown.set(symbol, info);
    for (const oldest of lastKnown.keys()) {
      if (lastKnown.size <= LAST_KNOWN_LIMIT) break;
      lastKnown.delete(oldest);
    }
  }

  async function sameCategoryMarkets(event: MarketEvent): Promise<readonly ResearchRelatedContract[]> {
    if (event.category === "") return [];
    const page = valueOr(await markets.searchEvents({ category: event.category, limit: RELATED_SEARCH_LIMIT }), { events: [], total: 0 });
    return page.events
      .filter((candidate) => candidate.ticker !== event.ticker)
      .flatMap((candidate) => {
        const lead = leadContract(candidate);
        return lead ? [toRelated(candidate, lead)] : [];
      })
      .slice(0, RELATED_EVENTS);
  }

  async function view(symbol: string, timeframe: ResearchTimeframe): Promise<ResearchResult> {
    const parsed = parseInstrumentSymbol(symbol);
    if (!parsed) return { kind: "unknown-symbol" };
    const plan = TIMEFRAME_PLANS[timeframe];
    const eventRequest = markets.getEvent(parsed.eventTicker, { refresh: true });
    const sameCategoryRequest = eventRequest.then((result) => (result.ok ? sameCategoryMarkets(result.value) : []));
    const candleMemo = new Map<CandleTimeframe, ReturnType<ResearchMarkets["candles"]>>();
    const requestCandles = (size: CandleTimeframe) => {
      const hit = candleMemo.get(size);
      if (hit !== undefined) return hit;
      const request = markets.candles(symbol, size);
      candleMemo.set(size, request);
      return request;
    };
    void requestCandles(plan.candle);
    void requestCandles(INDICATOR_CANDLE);
    const [eventResult, book, trades, postContext, matchedPosts, sameCategory] = await Promise.all([
      eventRequest,
      markets.orderBook(symbol),
      markets.recentTrades(symbol, TRADE_LIMIT),
      deps.postContextFor(symbol),
      deps.matchedPostsFor?.(symbol) ?? Promise.resolve([]),
      sameCategoryRequest,
    ]);
    const now = nowMs();
    let info: MarketInfo;
    let eventFreshness: "live" | "stale" = "live";
    if (eventResult.ok) {
      const contract = eventResult.value.contracts.find((candidate) => candidate.instrumentSymbol === symbol);
      if (!contract) return { kind: "unknown-symbol" };
      info = marketInfo({ event: eventResult.value, contract }, sameCategory);
      remember(symbol, info);
      history.watch(symbol);
      if (contract.prices.buyYesCents !== null) {
        history.record(symbol, {
          atMs: now,
          yesCents: contract.prices.buyYesCents,
          bidCents: contract.prices.bestBidCents,
          askCents: contract.prices.bestAskCents,
        });
      }
    } else if (isNotFound(eventResult.error)) {
      return { kind: "unknown-symbol" };
    } else {
      const known = lastKnown.get(symbol);
      if (!known) return { kind: "unavailable" };
      info = known;
      eventFreshness = "stale";
    }
    history.watch(symbol);
    const snapshots = history.series(symbol);
    const chartResult = await loadBestCandles(requestCandles, plan.candle, plan.windowMs, now);
    const hourlyResult = await requestCandles(INDICATOR_CANDLE);
    const chart = chartResult.candles;
    const hourly = valueOr(hourlyResult, []).length > 0 ? valueOr(hourlyResult, []) : chart;
    const bookView = valueOr(book, { bids: [], asks: [] });
    const tape = valueOr(trades, []);
    const historyTrades = chart.length === 0 && trades.ok ? await loadTradeHistory(markets, symbol, tape) : tape;
    const merged = mergeSeries({
      candles: chart,
      snapshots,
      trades: historyTrades,
      windowMs: plan.windowMs,
      nowMs: now,
      candleIntervalMs: CANDLE_INTERVAL_MS[chartResult.timeframe],
    });
    return {
      kind: "ok",
      view: {
        symbol,
        generatedAt: new Date(now).toISOString(),
        timeframe,
        ...info,
        data: {
          event: eventFreshness,
          candles: chartResult.live ? "live" : "unavailable",
          book: book.ok ? "live" : "unavailable",
          trades: trades.ok ? "live" : "unavailable",
        },
        series: { source: merged.source, points: [...merged.points] },
        book: { bids: [...cumulativeDepth(bookView.bids, "bids")], asks: [...cumulativeDepth(bookView.asks, "asks")] },
        trades: [...valueOr(trades, [])],
        indicators: computeIndicators(hourlyIndicatorPoints(hourly, snapshots)),
        postContext: withTimestamp(postContext ?? null),
        matchedPosts: uniquePosts([
          ...matchedPosts.map((post) => withTimestamp(post)),
          ...(postContext ? [withTimestamp(postContext)] : []),
          ...(deps.chatterFor?.(symbol) ?? []),
        ].filter((post): post is ResearchPostContext => post !== null)),
      },
    };
  }

  return {
    view,
    async brief(symbol) {
      const result = await view(symbol, BRIEF_TIMEFRAME);
      if (result.kind !== "ok") return result;
      const template = composeLibraryBrief(result.view);
      return { kind: "ok", template, polished: () => polishBrief(template, deps.llm) };
    },
  };
}
