import { marketPolicyRefusal } from "@/features/guardrails";
import type { Policy } from "@/features/guardrails";
import type { HistoryStore, PriceSnapshot } from "@/features/history";
import { parseInstrumentSymbol, type Candle, type GeminiMarketsClient, type MarketContract, type MarketEvent } from "@/features/markets";
import type { CatalogCard, CatalogPage } from "@/shared";
import { uniqueByKey } from "@/shared";
import { categoryLabel, categoryQuery, changePercent, downsample, formatEndsIn, smoothSeries, SPARKLINE_POINTS, WINDOW_MS } from "./format";

const FETCH_LIMIT = 40;
const CANDLE_BUDGET = 12;
const DEFAULT_LIMIT = 6;

export interface CatalogQuery {
  readonly search?: string;
  readonly category?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: "moving" | "default";
  readonly includeSparklines?: boolean;
}

export type CatalogListResult =
  | { readonly ok: true; readonly page: CatalogPage }
  | { readonly ok: false; readonly reason: "unavailable" | "busy" };

export interface CatalogDeps {
  readonly markets: Pick<GeminiMarketsClient, "searchEvents" | "candles"> & Partial<Pick<GeminiMarketsClient, "getEvent">>;
  readonly history: HistoryStore;
  readonly now: () => Date;
  readonly policy?: Policy;
}

function pickContract(event: MarketEvent): MarketContract | undefined {
  const priced = event.contracts.find((contract) => contract.prices.buyYesCents !== null && contract.marketState !== "closed");
  return priced ?? event.contracts[0];
}

function snapshotsToValues(points: readonly PriceSnapshot[], cutoff: number): { values: number[]; times: number[] } {
  const inWindow = points.filter((point) => point.atMs >= cutoff);
  const source = inWindow.length >= 2 ? inWindow : points;
  return { values: source.map((point) => point.yesCents), times: source.map((point) => point.atMs) };
}

function candlesToValues(points: readonly Candle[], cutoff: number): { values: number[]; times: number[] } {
  const inWindow = points.filter((point) => point.timeMs >= cutoff);
  const source = inWindow.length >= 2 ? inWindow : points;
  return { values: source.map((point) => point.closeCents), times: source.map((point) => point.timeMs) };
}

export async function listCatalog(deps: CatalogDeps, query: CatalogQuery = {}): Promise<CatalogListResult> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), 48);
  const search = query.search?.trim();
  const category = categoryQuery(query.category ?? "");
  const searched = await deps.markets.searchEvents({
    status: "active",
    limit: FETCH_LIMIT,
    ...(query.offset === undefined ? {} : { offset: query.offset }),
    ...(search === undefined || search === "" ? {} : { search }),
    ...(category === undefined ? {} : { category }),
  });
  if (!searched.ok) return { ok: false, reason: searched.error.kind === "busy" ? "busy" : "unavailable" };

  const now = deps.now();
  const cutoff = now.getTime() - WINDOW_MS;
  const pending: { event: MarketEvent; contract: MarketContract }[] = [];
  for (const event of searched.value.events) {
    const contract = pickContract(event);
    if (contract !== undefined) pending.push({ event, contract });
  }

  const cards: CatalogCard[] = [];
  for (const { event, contract } of pending) {
    const values = snapshotsToValues(deps.history.series(contract.instrumentSymbol), cutoff).values;
    const first = values[0];
    const last = values.at(-1);
    const change = first !== undefined && last !== undefined ? changePercent(first, last) : null;
    const refusal = deps.policy === undefined ? undefined : marketPolicyRefusal(deps.policy, contract.instrumentSymbol, event.category);
    cards.push({
      eventTicker: event.ticker,
      eventTitle: event.title,
      contractLabel: contract.label,
      instrumentSymbol: contract.instrumentSymbol,
      category: event.category,
      categoryLabel: categoryLabel(event.category),
      expiryDate: contract.expiryDate ?? event.expiryDate,
      endsIn: formatEndsIn(contract.expiryDate ?? event.expiryDate, now),
      yesCents: contract.prices.buyYesCents ?? contract.prices.lastTradeCents,
      noCents: contract.prices.buyNoCents,
      changePercent: change,
      sparkline: smoothSeries(downsample(values, SPARKLINE_POINTS)),
      tradeable: refusal === undefined,
      ...(refusal === undefined ? {} : { tradeBlockedReason: refusal }),
    });
  }

  if (query.sort === "moving") {
    cards.sort((left, right) => {
      const leftMove = left.changePercent === null ? -1 : Math.abs(left.changePercent);
      const rightMove = right.changePercent === null ? -1 : Math.abs(right.changePercent);
      return rightMove - leftMove;
    });
  }

  const categories = [...new Set(searched.value.events.map((event) => categoryLabel(event.category)))].sort();
  let markets = uniqueByKey(cards, (card) => card.instrumentSymbol).slice(0, limit);
  if (query.includeSparklines === true) {
    markets = await enrichSparklines(deps, markets);
    if (query.sort === "moving") {
      markets = [...markets].sort((left, right) => {
        const leftMove = left.changePercent === null ? -1 : Math.abs(left.changePercent);
        const rightMove = right.changePercent === null ? -1 : Math.abs(right.changePercent);
        return rightMove - leftMove;
      });
    }
  }
  return {
    ok: true,
    page: { markets, total: searched.value.total, categories, stale: false },
  };
}


export async function enrichSparklines(deps: CatalogDeps, cards: readonly CatalogCard[], budget = CANDLE_BUDGET): Promise<CatalogCard[]> {
  const now = deps.now();
  const cutoff = now.getTime() - WINDOW_MS;
  const needed = cards.filter((card) => card.sparkline.length < 2).slice(0, budget);
  const updates = new Map<string, { sparkline: number[]; changePercent: number | null }>();
  await Promise.all(needed.map(async (card) => {
    const candles = await deps.markets.candles(card.instrumentSymbol, "15m");
    if (!candles.ok || candles.value.length === 0) return;
    const fromCandles = candlesToValues(candles.value, cutoff);
    deps.history.watch(card.instrumentSymbol);
    for (const candle of candles.value) {
      deps.history.record(card.instrumentSymbol, {
        atMs: candle.timeMs,
        yesCents: candle.closeCents,
        bidCents: null,
        askCents: null,
      });
    }
    const first = fromCandles.values[0];
    const last = fromCandles.values.at(-1);
    updates.set(card.instrumentSymbol, {
      sparkline: smoothSeries(downsample(fromCandles.values, SPARKLINE_POINTS)),
      changePercent: first !== undefined && last !== undefined ? changePercent(first, last) : null,
    });
  }));
  return cards.map((card) => {
    const update = updates.get(card.instrumentSymbol);
    return update === undefined ? card : { ...card, sparkline: update.sparkline, changePercent: update.changePercent };
  });
}


export async function sparklineUpdates(deps: CatalogDeps, symbols: readonly string[]): Promise<Readonly<Record<string, { readonly sparkline: number[]; readonly changePercent: number | null }>>> {
  const stubs: CatalogCard[] = symbols.map((symbol) => ({
    eventTicker: "",
    eventTitle: "",
    contractLabel: "",
    instrumentSymbol: symbol,
    category: "",
    categoryLabel: "",
    expiryDate: null,
    endsIn: null,
    yesCents: null,
    noCents: null,
    changePercent: null,
    sparkline: [],
    tradeable: true,
  }));
  const enriched = await enrichSparklines(deps, stubs);
  const updates: Record<string, { sparkline: number[]; changePercent: number | null }> = {};
  for (const card of enriched) {
    if (card.sparkline.length >= 2) updates[card.instrumentSymbol] = { sparkline: card.sparkline, changePercent: card.changePercent };
  }
  return updates;
}

export async function cardsForSymbols(deps: CatalogDeps, symbols: readonly string[]): Promise<CatalogCard[]> {
  const listed = await listCatalog(deps, { sort: "default", limit: 48, includeSparklines: true });
  const found = new Map((listed.ok ? listed.page.markets : []).map((card) => [card.instrumentSymbol, card]));
  const cards: CatalogCard[] = [];
  for (const symbol of symbols) {
    const existing = found.get(symbol);
    if (existing !== undefined) {
      cards.push(existing);
      continue;
    }
    const parsed = parseInstrumentSymbol(symbol);
    if (parsed === undefined || deps.markets.getEvent === undefined) continue;
    const eventResult = await deps.markets.getEvent(parsed.eventTicker);
    if (!eventResult.ok) continue;
    const event = eventResult.value;
    const contract = event.contracts.find((item) => item.instrumentSymbol === symbol) ?? pickContract(event);
    if (contract === undefined) continue;
    const nested = await listCatalog(
      { ...deps, markets: { ...deps.markets, searchEvents: () => Promise.resolve({ ok: true, value: { events: [event], total: 1 } }) } },
      { sort: "default", limit: 1 },
    );
    if (nested.ok && nested.page.markets[0] !== undefined) cards.push(nested.page.markets[0]);
  }
  return cards;
}
