import type { HistoryStore } from "@/features/history";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import {
  formatMarketWhen,
  formatPayoutFromAsk,
  formatVolumeUsd,
  friendlyEventTitle,
  marketSearchTerm,
  uniqueByKey,
} from "@/shared";
import type { BrowseCard, BrowsePage, BrowseRow, BrowseSort } from "@/shared";
import { categoryLabel, categoryQuery, changePercent, WINDOW_MS } from "./format";

const PAGE_SIZE = 24;
const WINDOW_CAP = 96;
const FETCH_SIZE = 24;
const VIEW_TZ = "America/Chicago";
const KNOWN_TABS: readonly { id: string; label: string; live: boolean }[] = [
  { id: "All", label: "All", live: false },
  { id: "Live", label: "Live", live: true },
  { id: "Sports", label: "Sports", live: false },
  { id: "Crypto", label: "Crypto", live: false },
  { id: "Economy", label: "Economy", live: false },
  { id: "Politics", label: "Politics", live: false },
  { id: "Tech and AI", label: "Tech and AI", live: false },
  { id: "Weather", label: "Weather", live: false },
  { id: "Culture", label: "Culture", live: false },
  { id: "Commodities", label: "Commodities", live: false },
];

export interface BrowseDeps {
  readonly markets: Pick<GeminiMarketsClient, "searchEvents" | "candles" | "pubticker">;
  readonly history: HistoryStore;
  readonly now: () => Date;
}

export interface BrowseQuery {
  readonly search?: string;
  readonly category?: string;
  readonly sort?: BrowseSort;
  readonly offset?: number;
  readonly limit?: number;
}

export type BrowseListResult =
  | { readonly ok: true; readonly page: BrowsePage }
  | { readonly ok: false; readonly reason: "busy" | "unavailable" };

function displayCategory(event: MarketEvent): string {
  if (event.subcategory !== null && event.subcategory.trim() !== "") return event.subcategory;
  return categoryLabel(event.category);
}

function tickerAsset(eventTicker: string): string | undefined {
  const match = /^([A-Z]+)/u.exec(eventTicker);
  return match?.[1];
}

function spotPair(asset: string): string {
  return `${asset.toLowerCase()}usd`;
}

function formatSpot(last: number): string {
  if (last >= 1000) return `$${last.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (last >= 10) return `$${last.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${last.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).replace(/0+$/u, "").replace(/\.$/u, "")}`;
}

function yesAsk(contract: MarketContract): number | null {
  return contract.prices.buyYesCents;
}

function isSports(event: MarketEvent): boolean {
  return event.category.trim().toLowerCase() === "sports";
}

function isBinary(contracts: readonly MarketContract[]): boolean {
  if (contracts.length !== 2) return false;
  const labels = contracts.map((contract) => contract.label.trim().toLowerCase()).sort();
  return labels[0] === "no" && labels[1] === "yes";
}

function kindOf(event: MarketEvent): BrowseCard["kind"] {
  if (isSports(event)) return "sports";
  if (event.category.trim().toLowerCase() === "crypto") return "crypto";
  if (isBinary(event.contracts)) return "binary";
  return "other";
}

function researchHref(symbol: string): string {
  return `/markets/${encodeURIComponent(symbol)}`;
}

function pricedYes(contract: MarketContract): number | null {
  return yesAsk(contract) ?? contract.prices.lastTradeCents;
}

function rowFor(contract: MarketContract): BrowseRow {
  const ask = yesAsk(contract);
  return {
    instrumentSymbol: contract.instrumentSymbol,
    label: contract.label,
    yesCents: pricedYes(contract),
    payoutBeginner: formatPayoutFromAsk(ask, true),
    payoutPro: formatPayoutFromAsk(ask, false),
    href: researchHref(contract.instrumentSymbol),
  };
}

function pickRows(event: MarketEvent, spot: number | undefined): MarketContract[] {
  const open = event.contracts.filter((contract) => contract.marketState !== "closed");
  const pool = open.length > 0 ? open : [...event.contracts];
  if (pool.length <= 2) return pool;
  if (isSports(event)) return pool.slice(0, 2);
  if (isBinary(pool)) return pool;
  if (spot !== undefined) {
    const withStrike = pool.filter((contract) => contract.strikeValue !== undefined && contract.strikeValue !== null);
    if (withStrike.length >= 2) {
      return [...withStrike].sort((left, right) => Math.abs((left.strikeValue ?? spot) - spot) - Math.abs((right.strikeValue ?? spot) - spot)).slice(0, 2);
    }
  }
  return [...pool].sort((left, right) => {
    const leftYes = pricedYes(left);
    const rightYes = pricedYes(right);
    if (leftYes === null && rightYes !== null) return 1;
    if (rightYes === null && leftYes !== null) return -1;
    const leftGap = Math.abs((leftYes ?? 50) - 50);
    const rightGap = Math.abs((rightYes ?? 50) - 50);
    return leftGap - rightGap;
  }).slice(0, 2);
}

function leadContract(event: MarketEvent, rows: readonly MarketContract[]): MarketContract | undefined {
  return rows[0] ?? event.contracts[0];
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

export async function loadSpotPrices(deps: { readonly markets: Pick<GeminiMarketsClient, "pubticker"> }, assets: readonly string[]): Promise<Readonly<Record<string, string>>> {
  const spots: Record<string, string> = {};
  await mapPool([...new Set(assets.map((asset) => asset.trim().toUpperCase()).filter(Boolean))], 4, async (asset) => {
    const quoted = await deps.markets.pubticker(spotPair(asset));
    if (quoted.ok) spots[asset] = formatSpot(quoted.value.last);
  });
  return spots;
}

function changeFor(deps: BrowseDeps, symbol: string, nowMs: number): number | null {
  const cutoff = nowMs - WINDOW_MS;
  const points = deps.history.series(symbol).filter((point) => point.atMs >= cutoff);
  const source = points.length >= 2 ? points : deps.history.series(symbol);
  const first = source[0]?.yesCents;
  const last = source.at(-1)?.yesCents;
  if (first === undefined || last === undefined) return null;
  return changePercent(first, last);
}

function matchesCategory(event: MarketEvent, category: string | undefined): boolean {
  if (category === undefined || category === "" || category === "All") return true;
  if (category === "Live") return event.isLive === true;
  const expected = categoryQuery(category);
  if (expected === undefined) return true;
  return event.category.trim().toLowerCase() === expected.trim().toLowerCase();
}

function sortEvents(events: BrowseCard[], sort: BrowseSort): BrowseCard[] {
  const copy = [...events];
  if (sort === "closing") {
    copy.sort((left, right) => {
      const leftTime = left.expiryDate === null ? Number.POSITIVE_INFINITY : Date.parse(left.expiryDate);
      const rightTime = right.expiryDate === null ? Number.POSITIVE_INFINITY : Date.parse(right.expiryDate);
      return leftTime - rightTime;
    });
  } else if (sort === "newest") {
    copy.sort((left, right) => Date.parse(right.createdAt ?? "0") - Date.parse(left.createdAt ?? "0"));
  } else if (sort === "move") {
    copy.sort((left, right) => Math.abs(right.changePercent ?? -1) - Math.abs(left.changePercent ?? -1));
  } else {
    copy.sort((left, right) => (right.volume ?? -1) - (left.volume ?? -1));
  }
  return copy;
}

function toCard(event: MarketEvent, now: Date, spots: Map<string, number>, deps: BrowseDeps): BrowseCard | undefined {
  const asset = tickerAsset(event.ticker);
  const spot = asset === undefined ? undefined : spots.get(asset);
  const selected = pickRows(event, spot);
  const lead = leadContract(event, selected);
  if (lead === undefined) return undefined;
  const kind = kindOf(event);
  const displayTitle = friendlyEventTitle(event.title, event.expiryDate ?? lead.expiryDate, now, VIEW_TZ);
  return {
    eventTicker: event.ticker,
    eventTitle: event.title,
    displayTitle,
    instrumentSymbol: lead.instrumentSymbol,
    href: researchHref(lead.instrumentSymbol),
    category: event.category,
    categoryLabel: displayCategory(event),
    kind,
    isLive: event.isLive === true,
    when: event.isLive === true ? null : formatMarketWhen(event.expiryDate ?? lead.expiryDate, now, VIEW_TZ),
    spotLabel: kind === "crypto" && spot !== undefined ? formatSpot(spot) : null,
    imageUrl: event.imageUrl ?? null,
    volume: event.volume24h ?? event.volume,
    volumeLabel: event.volume24h !== null || event.volume !== null ? formatVolumeUsd(event.volume24h ?? event.volume ?? 0) : null,
    rows: selected.map(rowFor),
    changePercent: changeFor(deps, lead.instrumentSymbol, now.getTime()),
    createdAt: event.createdAt ?? null,
    expiryDate: event.expiryDate ?? lead.expiryDate,
  };
}

export async function listBrowse(deps: BrowseDeps, query: BrowseQuery = {}): Promise<BrowseListResult> {
  const limit = Math.min(Math.max(query.limit ?? PAGE_SIZE, 1), WINDOW_CAP);
  const offset = Math.max(query.offset ?? 0, 0);
  const category = query.category;
  const needed = category === "Live" ? Math.min(Math.max(offset + limit, FETCH_SIZE * 2), WINDOW_CAP) : Math.min(offset + limit, WINDOW_CAP);
  const geminiCategory = category === undefined || category === "" || category === "All" || category === "Live" ? undefined : categoryQuery(category);
  const scanCap = category === "Live" ? 192 : Math.min(Math.max(needed, FETCH_SIZE), WINDOW_CAP);
  const collected: MarketEvent[] = [];
  let pageOffset = 0;
  let total = 0;
  let exhausted = false;
  while (collected.length < needed && !exhausted) {
    const searched = await deps.markets.searchEvents({
      status: "active",
      limit: FETCH_SIZE,
      offset: pageOffset,
      ...(query.search === undefined || query.search.trim() === "" ? {} : { search: marketSearchTerm(query.search) }),
      ...(geminiCategory === undefined ? {} : { category: geminiCategory }),
    });
    if (!searched.ok) return { ok: false, reason: searched.error.kind === "busy" ? "busy" : "unavailable" };
    total = searched.value.total;
    const batch = searched.value.events.filter((event) => matchesCategory(event, category));
    collected.push(...batch);
    pageOffset += searched.value.events.length;
    if (searched.value.events.length < FETCH_SIZE || searched.value.events.length === 0) exhausted = true;
    if (pageOffset >= scanCap) break;
  }
  const window = uniqueByKey(collected, (event) => event.ticker).slice(0, WINDOW_CAP);
  const now = deps.now();
  const spots = new Map<string, number>();
  const cards = sortEvents(
    uniqueByKey(
      window.map((event) => toCard(event, now, spots, deps)).filter((card): card is BrowseCard => card !== undefined),
      (card) => card.eventTicker,
    ),
    query.sort ?? "trending",
  );
  const slice = uniqueByKey(cards.slice(offset, offset + limit), (card) => card.eventTicker);
  const moreInWindow = offset + slice.length < cards.length;
  const moreUpstream = !exhausted && pageOffset < total && offset + limit < WINDOW_CAP;
  return {
    ok: true,
    page: {
      markets: slice,
      total,
      offset,
      hasMore: moreInWindow || moreUpstream,
      tabs: KNOWN_TABS.map((tab) => ({ ...tab })),
      stale: false,
    },
  };
}

export { KNOWN_TABS, PAGE_SIZE };
