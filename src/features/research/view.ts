import type { HistoryStore } from "@/features/history";
import type { Candle, GeminiMarketsClient, MarketContract, MarketEvent, MarketsError, MarketsResult } from "@/features/markets";
import { parseInstrumentSymbol } from "@/features/markets";
import type { ResearchPostContext, ResearchRelatedContract, ResearchTimeframe, ResearchView } from "@/shared";
import { computeIndicators } from "./indicators";
import { cumulativeDepth, hourlyIndicatorPoints, INDICATOR_CANDLE, mergeSeries, TIMEFRAME_PLANS } from "./series";

const RELATED_EVENTS = 6;
const RELATED_SEARCH_LIMIT = 12;
const LAST_KNOWN_LIMIT = 50;
const TRADE_LIMIT = 30;

export type ResearchMarkets = Pick<GeminiMarketsClient, "getEvent" | "searchEvents" | "candles" | "orderBook" | "recentTrades">;

export interface ResearchDeps {
  readonly markets: ResearchMarkets;
  readonly history: HistoryStore;
  readonly nowMs: () => number;
  readonly postContextFor: (symbol: string) => Promise<ResearchPostContext | undefined>;
}

export type ResearchResult =
  | { readonly kind: "ok"; readonly view: ResearchView }
  | { readonly kind: "unknown-symbol" }
  | { readonly kind: "unavailable" };

export interface Research {
  readonly view: (symbol: string, timeframe: ResearchTimeframe) => Promise<ResearchResult>;
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
      volume: event.volume,
      volume24h: event.volume24h,
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

  return {
    async view(symbol, timeframe) {
      const parsed = parseInstrumentSymbol(symbol);
      if (!parsed) return { kind: "unknown-symbol" };
      const plan = TIMEFRAME_PLANS[timeframe];
      const [eventResult, chartCandles, hourlyCandles, book, trades, postContext] = await Promise.all([
        markets.getEvent(parsed.eventTicker, { refresh: true }),
        markets.candles(symbol, plan.candle),
        markets.candles(symbol, INDICATOR_CANDLE),
        markets.orderBook(symbol),
        markets.recentTrades(symbol, TRADE_LIMIT),
        deps.postContextFor(symbol),
      ]);
      const now = nowMs();
      let info: MarketInfo;
      let eventFreshness: "live" | "stale" = "live";
      if (eventResult.ok) {
        const contract = eventResult.value.contracts.find((candidate) => candidate.instrumentSymbol === symbol);
        if (!contract) return { kind: "unknown-symbol" };
        info = marketInfo({ event: eventResult.value, contract }, await sameCategoryMarkets(eventResult.value));
        remember(symbol, info);
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
      const chart: readonly Candle[] = valueOr(chartCandles, []);
      const hourly: readonly Candle[] = valueOr(hourlyCandles, []);
      const bookView = valueOr(book, { bids: [], asks: [] });
      const merged = mergeSeries({ candles: chart, snapshots, windowMs: plan.windowMs, nowMs: now });
      return {
        kind: "ok",
        view: {
          symbol,
          generatedAt: new Date(now).toISOString(),
          timeframe,
          ...info,
          data: {
            event: eventFreshness,
            candles: chartCandles.ok ? "live" : "unavailable",
            book: book.ok ? "live" : "unavailable",
            trades: trades.ok ? "live" : "unavailable",
          },
          series: { source: merged.source, points: [...merged.points] },
          book: { bids: [...cumulativeDepth(bookView.bids, "bids")], asks: [...cumulativeDepth(bookView.asks, "asks")] },
          trades: [...valueOr(trades, [])],
          indicators: computeIndicators(hourlyIndicatorPoints(hourly, snapshots)),
          postContext: postContext ?? null,
        },
      };
    },
  };
}
