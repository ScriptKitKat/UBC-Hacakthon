import { marketPolicyRefusal } from "@/features/guardrails";
import type { Policy } from "@/features/guardrails";
import type { HistoryStore, PriceSnapshot } from "@/features/history";
import { parseInstrumentSymbol, type Candle, type GeminiMarketsClient, type MarketContract, type MarketEvent } from "@/features/markets";
import type { CatalogCard, CatalogPage } from "@/shared";
import { categoryLabel, categoryQuery, changePercent, downsample, formatEndsIn, SPARKLINE_POINTS, WINDOW_MS } from "./format";

const FETCH_LIMIT = 40;
const CANDLE_BUDGET = 12;
const DEFAULT_LIMIT = 6;

export interface CatalogQuery {
  readonly search?: string;
  readonly category?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly sort?: "moving" | "default";
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

  let candleUses = 0;
  const cards: CatalogCard[] = [];
  for (const { event, contract } of pending) {
    const fromHistory = snapshotsToValues(deps.history.series(contract.instrumentSymbol), cutoff);
    let values = fromHistory.values;
    if (values.length < 2 && candleUses < CANDLE_BUDGET) {
      candleUses += 1;
      const candles = await deps.markets.candles(contract.instrumentSymbol, "1hr");
      if (candles.ok && candles.value.length > 0) {
        const fromCandles = candlesToValues(candles.value, cutoff);
        values = fromCandles.values;
        deps.history.watch(contract.instrumentSymbol);
        for (const candle of candles.value) {
          deps.history.record(contract.instrumentSymbol, {
            atMs: candle.timeMs,
            yesCents: candle.closeCents,
            bidCents: null,
            askCents: null,
          });
        }
      }
    }
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
      sparkline: downsample(values, SPARKLINE_POINTS),
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
  return {
    ok: true,
    page: { markets: cards.slice(0, limit), total: searched.value.total, categories },
  };
}

export async function cardsForSymbols(deps: CatalogDeps, symbols: readonly string[]): Promise<CatalogCard[]> {
  const listed = await listCatalog(deps, { sort: "default", limit: 48 });
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
