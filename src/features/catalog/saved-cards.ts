import type { MarketContract, MarketEvent } from "@/features/markets";
import { parseInstrumentSymbol } from "@/features/markets";
import type { WatchlistCard } from "@/shared";
import { friendlyEventTitle, sparklinePointDelta } from "@/shared";
import { categoryLabel, changePercent, downsample, formatEndsIn, smoothSeries, SPARKLINE_POINTS, WINDOW_MS } from "./format";
import { enrichSparklines, type CatalogDeps } from "./list";
import type { WatchlistItem } from "./watchlist";

const CANDLE_BATCH = 12;

function historySeries(deps: CatalogDeps, symbol: string, now: Date): { sparkline: number[]; changePercent: number | null; todayPoints: number | null } {
  const cutoff = now.getTime() - WINDOW_MS;
  const points = deps.history.series(symbol);
  const inWindow = points.filter((point) => point.atMs >= cutoff);
  const source = inWindow.length >= 2 ? inWindow : points;
  const values = source.map((point) => point.yesCents);
  const sparkline = smoothSeries(downsample(values, SPARKLINE_POINTS));
  const first = values[0];
  const last = values.at(-1);
  const change = first !== undefined && last !== undefined ? changePercent(first, last) : null;
  return { sparkline, changePercent: change, todayPoints: sparklinePointDelta(values) };
}


function pickContract(event: MarketEvent, instrumentSymbol: string | null): MarketContract | undefined {
  if (instrumentSymbol !== null) {
    const exact = event.contracts.find((contract) => contract.instrumentSymbol === instrumentSymbol);
    if (exact !== undefined) return exact;
  }
  const priced = event.contracts.find((contract) => contract.prices.buyYesCents !== null && contract.marketState !== "closed");
  return priced ?? event.contracts[0];
}

export function marketLifecycle(event: Pick<MarketEvent, "status" | "expiryDate">, contract: Pick<MarketContract, "status" | "marketState" | "expiryDate">, now: Date): WatchlistCard["status"] {
  const tokens = `${event.status} ${contract.status} ${contract.marketState}`.toLowerCase();
  if (/\b(settled|determined|finalized|resolved)\b/u.test(tokens)) return "settled";
  const expiry = contract.expiryDate ?? event.expiryDate;
  if (expiry !== null && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) <= now.getTime()) return "ended";
  if (/\b(closed|inactive|expired)\b/u.test(tokens)) return "ended";
  return "live";
}

export function researchHref(symbol: string): string {
  return `/markets/${encodeURIComponent(symbol)}?contract=${encodeURIComponent(symbol)}`;
}

function placeholderCard(item: WatchlistItem): WatchlistCard {
  const symbol = item.instrumentSymbol ?? item.eventTicker;
  return {
    eventTicker: item.eventTicker,
    eventTitle: item.eventTicker,
    contractLabel: "",
    instrumentSymbol: symbol,
    category: "",
    categoryLabel: "Other",
    expiryDate: null,
    endsIn: "ended",
    imageUrl: null,
    yesCents: item.savedYesCents,
    yesAskCents: null,
    noCents: null,
    changePercent: null,
    sparkline: [],
    tradeable: false,
    savedAt: item.savedAt,
    savedYesCents: item.savedYesCents,
    todayPoints: null,
    status: "ended",
    href: researchHref(symbol),
  };
}

function cardFromEvent(deps: CatalogDeps, item: WatchlistItem, event: MarketEvent, contract: MarketContract, now: Date): WatchlistCard {
  const expiryDate = contract.expiryDate ?? event.expiryDate;
  const yesCents = contract.prices.buyYesCents ?? contract.prices.lastTradeCents;
  return {
    eventTicker: event.ticker,
    eventTitle: event.title,
    contractLabel: contract.label,
    instrumentSymbol: contract.instrumentSymbol,
    category: event.category,
    categoryLabel: categoryLabel(event.category),
    expiryDate,
    endsIn: formatEndsIn(expiryDate, now),
    imageUrl: event.imageUrl ?? null,
    yesCents,
    yesAskCents: contract.prices.buyYesCents,
    noCents: contract.prices.buyNoCents,
    ...historySeries(deps, contract.instrumentSymbol, now),
    tradeable: marketLifecycle(event, contract, now) === "live",
    savedAt: item.savedAt,
    savedYesCents: item.savedYesCents,
    status: marketLifecycle(event, contract, now),
    href: researchHref(contract.instrumentSymbol),
  };
}

async function mapPool<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index] as T);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

async function fillSparklines(deps: CatalogDeps, cards: readonly WatchlistCard[]): Promise<WatchlistCard[]> {
  let current = [...cards];
  for (let pass = 0; pass < 4; pass += 1) {
    if (current.every((card) => card.sparkline.length >= 2 || card.status !== "live")) break;
    const enriched = await enrichSparklines(deps, current, CANDLE_BATCH);
    const next = current.map((card, index) => {
      const update = enriched[index];
      if (update === undefined) return card;
      const sparkline = update.sparkline;
      return { ...card, sparkline, changePercent: update.changePercent, todayPoints: sparklinePointDelta(sparkline) };
    });
    if (next.every((card, index) => card.sparkline.length === (current[index]?.sparkline.length ?? 0))) {
      current = next;
      break;
    }
    current = next;
  }
  return current.map((card) => ({ ...card, todayPoints: sparklinePointDelta(card.sparkline) }));
}

export async function lookupYesCents(deps: CatalogDeps, item: WatchlistItem): Promise<number | null> {
  const ticker = item.eventTicker === "" ? parseInstrumentSymbol(item.instrumentSymbol ?? "")?.eventTicker : item.eventTicker;
  if (ticker === undefined || deps.markets.getEvent === undefined) return null;
  const result = await deps.markets.getEvent(ticker);
  if (!result.ok) return null;
  const contract = pickContract(result.value, item.instrumentSymbol);
  return contract === undefined ? null : contract.prices.buyYesCents ?? contract.prices.lastTradeCents;
}

export async function cardsForSaved(deps: CatalogDeps, items: readonly WatchlistItem[]): Promise<WatchlistCard[]> {
  const now = deps.now();
  const built = await mapPool(items, 4, async (item): Promise<WatchlistCard> => {
    if (deps.markets.getEvent === undefined) return placeholderCard(item);
    const result = await deps.markets.getEvent(item.eventTicker);
    if (!result.ok) return placeholderCard(item);
    const contract = pickContract(result.value, item.instrumentSymbol);
    if (contract === undefined) return placeholderCard(item);
    return cardFromEvent(deps, item, result.value, contract, now);
  });
  const filled = await fillSparklines(deps, built);
  return filled.map((card) => ({
    ...card,
    eventTitle: friendlyEventTitle(card.eventTitle, card.expiryDate, now),
  }));
}
