import type { Candle, GeminiMarketsClient, MarketContract, MarketEvent, MarketsResult } from "@/features/markets";
import { parseInstrumentSymbol } from "@/features/markets";
import { friendlyEventTitle, nextUtcMidnight } from "@/shared";
import type {
  DecisionLogEntry,
  DeskSnapshot,
  PositionsView,
  ProBudget,
  ProChart,
  ProLive,
  ProMarket,
  ProShell,
  ProTimeframe,
  ResearchPostContext,
} from "@/shared";
import { buildBook } from "./book";
import { buildFeed } from "./feed";
import { flowFromTrades } from "./flow";
import { chartBands, indicatorRows } from "./indicators";
import { strikeLadder } from "./ladder";
import { positionFor } from "./position";
import { buildSpot, spotPair, tickerAsset } from "./spot";
import { buildStats } from "./stats";
import { INDICATOR_CANDLE, MIN_TRADED_CANDLES, STATS_CANDLE, TIMEFRAME_PLANS, defaultProTimeframe, pickReadableTimeframe, planChartCandles, tradedCount } from "./timeframes";

export type MarketProMarkets = Pick<GeminiMarketsClient, "getEvent" | "candles" | "orderBook" | "recentTrades" | "pubticker">;

export interface MarketProDesk {
  readonly getSnapshot: () => Promise<DeskSnapshot>;
  readonly getPositions: () => Promise<PositionsView>;
  readonly postContextFor: (symbol: string) => Promise<ResearchPostContext | undefined>;
}

export interface MarketProDeps {
  readonly markets: MarketProMarkets;
  readonly nowMs: () => number;
  readonly desk: MarketProDesk;
  readonly isWatched: (symbol: string) => Promise<boolean>;
}

export type ProShellResult =
  | { readonly kind: "ok"; readonly shell: ProShell }
  | { readonly kind: "unknown-symbol" }
  | { readonly kind: "unavailable" };

export type ProLiveResult =
  | { readonly kind: "ok"; readonly live: ProLive }
  | { readonly kind: "unknown-symbol" }
  | { readonly kind: "unavailable" };

export interface MarketPro {
  readonly shell: (symbol: string, timeframe?: ProTimeframe) => Promise<ProShellResult>;
  readonly live: (symbol: string, timeframe: ProTimeframe) => Promise<ProLiveResult>;
}

const VIEW_TZ = "America/Chicago";
const TRADE_LIMIT = 50;

function valueOr<T>(result: MarketsResult<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

function isNotFound(result: MarketsResult<unknown>): boolean {
  return !result.ok && result.error.kind === "http" && (result.error.status === 404 || result.error.status === 400);
}

function marketView(event: MarketEvent, contract: MarketContract, nowMs: number): ProMarket {
  const expiry = contract.expiryDate ?? event.expiryDate;
  return {
    symbol: contract.instrumentSymbol,
    eventTicker: event.ticker,
    eventTitle: event.title,
    displayTitle: friendlyEventTitle(event.title, expiry, new Date(nowMs), VIEW_TZ),
    contractLabel: contract.label,
    category: event.category,
    subcategory: event.subcategory,
    expiryDate: expiry,
    eventStatus: event.status,
    marketState: contract.marketState,
    asset: tickerAsset(event.ticker) ?? null,
    imageUrl: event.imageUrl ?? null,
    volume: event.volume,
    yesAskCents: contract.prices.buyYesCents,
    noAskCents: contract.prices.buyNoCents,
    yesBidCents: contract.prices.sellYesCents ?? contract.prices.bestBidCents,
    noBidCents: contract.prices.sellNoCents,
    lastTradeCents: contract.prices.lastTradeCents,
    bestBidCents: contract.prices.bestBidCents,
    bestAskCents: contract.prices.bestAskCents,
    quantityLimits: contract.limits
      ? {
          quantityIncrementHundredths: Number(contract.limits.quantityIncrementHundredths),
          quantityMinimumHundredths: Number(contract.limits.quantityMinimumHundredths),
        }
      : null,
  };
}

function budgetFrom(snapshot: DeskSnapshot, nowMs: number): ProBudget {
  const { policy } = snapshot;
  return {
    dailyCapCents: policy.dailyCapCents,
    spentCents: policy.spentCents,
    remainingCents: policy.remainingCents,
    perTradeMaxCents: policy.perTradeMaxCents,
    autoApproveMaxCents: policy.autoApproveMaxCents,
    resetAt: nextUtcMidnight(new Date(nowMs)).toISOString(),
    senderId: policy.senderAllowlist[0] ?? null,
  };
}

function chartNote(traded: number, available: boolean): string | null {
  if (!available) return null;
  if (traded === 0) return "Almost no trading on this contract yet.";
  if (traded < MIN_TRADED_CANDLES) return "Not enough trading for Bollinger bands or RSI.";
  return null;
}

function toChart(candles: readonly Candle[], timeframe: ProTimeframe, nowMs: number, live: boolean): ProChart {
  const windowed = planChartCandles(candles, timeframe, nowMs);
  const traded = tradedCount(windowed);
  const overlays = traded >= MIN_TRADED_CANDLES;
  const computed = chartBands(windowed);
  const bands = overlays
    ? computed
    : computed.map((band) => ({ ...band, ma7: null, ma20: null, upper: null, lower: null, rsi: null }));
  const last = bands[bands.length - 1];
  return {
    timeframe,
    candles: windowed.map((candle) => ({ ...candle })),
    bands: [...bands],
    ma7Last: overlays ? last?.ma7 ?? null : null,
    ma20Last: overlays ? last?.ma20 ?? null : null,
    bbLower: overlays ? last?.lower ?? null : null,
    bbUpper: overlays ? last?.upper ?? null : null,
    rsiLast: overlays ? last?.rsi ?? null : null,
    source: live ? "live" : "unavailable",
    note: chartNote(traded, live || windowed.length > 0),
    overlay: null,
  };
}

export function createMarketPro(deps: MarketProDeps): MarketPro {
  const { markets, nowMs } = deps;

  async function loadEvent(symbol: string): Promise<
    | { readonly kind: "ok"; readonly event: MarketEvent; readonly contract: MarketContract }
    | { readonly kind: "unknown-symbol" }
    | { readonly kind: "unavailable" }
  > {
    const parsed = parseInstrumentSymbol(symbol);
    if (!parsed) return { kind: "unknown-symbol" };
    const result = await markets.getEvent(parsed.eventTicker, { refresh: true });
    if (result.ok) {
      const contract = result.value.contracts.find((candidate) => candidate.instrumentSymbol === symbol);
      if (!contract) return { kind: "unknown-symbol" };
      return { kind: "ok", event: result.value, contract };
    }
    return isNotFound(result) ? { kind: "unknown-symbol" } : { kind: "unavailable" };
  }

  async function loadChartCandles(symbol: string, timeframe: ProTimeframe): Promise<{ readonly candles: readonly Candle[]; readonly live: boolean }> {
    const plan = TIMEFRAME_PLANS[timeframe];
    const primary = await markets.candles(symbol, plan.source);
    if (primary.ok && primary.value.length > 0) return { candles: primary.value, live: true };
    if (plan.fallback !== null) {
      const fallback = await markets.candles(symbol, plan.fallback);
      if (fallback.ok && fallback.value.length > 0) return { candles: fallback.value, live: true };
      return { candles: [], live: primary.ok || fallback.ok };
    }
    return { candles: valueOr(primary, []), live: primary.ok };
  }

  return {
    async shell(symbol, timeframe) {
      const parsed = parseInstrumentSymbol(symbol);
      if (!parsed) return { kind: "unknown-symbol" };
      const guessedAsset = tickerAsset(parsed.eventTicker);
      const wantFiveMinute = timeframe === undefined || timeframe === "5m";
      const [loaded, hourly, fiveMinute, ticker, snapshot, positions, watched] = await Promise.all([
        loadEvent(symbol),
        markets.candles(symbol, STATS_CANDLE),
        wantFiveMinute ? loadChartCandles(symbol, "5m") : Promise.resolve(null),
        guessedAsset === undefined ? Promise.resolve(null) : markets.pubticker(spotPair(guessedAsset)),
        deps.desk.getSnapshot(),
        deps.desk.getPositions(),
        deps.isWatched(symbol),
      ]);
      if (loaded.kind !== "ok") return loaded;
      const now = nowMs();
      const { event, contract } = loaded;
      const hourlyValue = valueOr(hourly, []);
      const fiveMinuteValue = fiveMinute === null ? [] : fiveMinute.candles;
      const fallback = defaultProTimeframe(contract.expiryDate ?? event.expiryDate, now);
      const selected = timeframe ?? pickReadableTimeframe({
        "5m": tradedCount(planChartCandles(fiveMinuteValue, "5m", now)),
        "1h": tradedCount(planChartCandles(hourlyValue, "1h", now)),
        "4h": tradedCount(planChartCandles(hourlyValue, "4h", now)),
      }, fallback);
      const chartCandles = selected === "5m" && fiveMinute !== null
        ? fiveMinute
        : (selected === "1h" || selected === "4h") && hourly.ok && hourly.value.length > 0
          ? { candles: hourly.value, live: true }
          : await loadChartCandles(symbol, selected);
      const spotLast = ticker !== null && ticker.ok ? ticker.value.last : null;
      return {
        kind: "ok",
        shell: {
          generatedAt: new Date(now).toISOString(),
          market: marketView(event, contract, now),
          stats: buildStats({
            prices: contract.prices,
            hourly: hourlyValue,
            volume: event.volume,
            volume24h: event.volume24h,
            expiryDate: contract.expiryDate ?? event.expiryDate,
            nowMs: now,
          }),
          chart: toChart(chartCandles.candles, selected, now, chartCandles.live),
          ladder: [...strikeLadder(event, symbol)],
          spot: buildSpot({ event, symbol, last: spotLast }),
          budget: budgetFrom(snapshot, now),
          position: positionFor(positions.positions, symbol),
          watched,
          freshness: "live",
        },
      };
    },

    async live(symbol) {
      const [loaded, bookResult, tradeResult, hourly, snapshot, positions, watched, post] = await Promise.all([
        loadEvent(symbol),
        markets.orderBook(symbol),
        markets.recentTrades(symbol, TRADE_LIMIT),
        markets.candles(symbol, INDICATOR_CANDLE),
        deps.desk.getSnapshot(),
        deps.desk.getPositions(),
        deps.isWatched(symbol),
        deps.desk.postContextFor(symbol),
      ]);
      if (loaded.kind !== "ok") return loaded;
      const now = nowMs();
      const book = buildBook(bookResult.ok ? bookResult.value : null);
      const trades = valueOr(tradeResult, []);
      const hourlyValue = valueOr(hourly, []);
      const log: readonly DecisionLogEntry[] = snapshot.log;
      return {
        kind: "ok",
        live: {
          generatedAt: new Date(now).toISOString(),
          book,
          trades: { items: trades.map((trade) => ({ ...trade })), source: tradeResult.ok ? "live" : "unavailable" },
          indicators: [...indicatorRows({
            hourly: hourlyValue,
            nowMs: now,
            lastCents: loaded.contract.prices.lastTradeCents ?? loaded.contract.prices.buyYesCents,
            depthPlusMinus5: book.depthPlusMinus5,
          })],
          flow: flowFromTrades(trades),
          feed: [...buildFeed({ log, symbol, post: post ?? null, candles: hourlyValue, nowMs: now })],
          position: positionFor(positions.positions, symbol),
          budget: budgetFrom(snapshot, now),
          watched,
        },
      };
    },
  };
}
