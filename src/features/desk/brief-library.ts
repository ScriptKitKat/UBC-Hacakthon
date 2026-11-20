import { parseInstrumentSymbol } from "@/features/markets";
import type { MarketEvent } from "@/features/markets";
import {
  defaultBriefAuthor,
  libraryStats,
  needsRefresh,
  oddsDeltaPoints,
  resolutionFromStatus,
  yesCentsFromBrief,
} from "@/shared";
import type { BriefLibraryItem, BriefLibraryView } from "@/shared";
import type { StoredPurchase } from "./purchase-store";

export interface LiveBriefMark {
  readonly category: string;
  readonly eventTitle: string;
  readonly contractLabel: string;
  readonly eventStatus: string;
  readonly contractStatus: string;
  readonly marketState: string;
  readonly resolutionSide?: "yes" | "no";
  readonly yesCents: number | null;
}

export type EventLookup = (ticker: string) => Promise<{ readonly ok: true; readonly value: MarketEvent } | { readonly ok: false }>;

export function liveMarkFromEvent(event: MarketEvent, symbol: string): LiveBriefMark | null {
  const contract = event.contracts.find((candidate) => candidate.instrumentSymbol === symbol);
  if (contract === undefined) return null;
  const settled = event.status === "settled" || contract.status === "settled";
  const yesCents = settled && contract.resolutionSide === "yes"
    ? 100
    : settled && contract.resolutionSide === "no"
      ? 0
      : contract.prices.buyYesCents;
  return {
    category: event.category,
    eventTitle: event.title,
    contractLabel: contract.label,
    eventStatus: event.status,
    contractStatus: contract.status,
    marketState: contract.marketState,
    yesCents,
    ...(contract.resolutionSide === "yes" || contract.resolutionSide === "no" ? { resolutionSide: contract.resolutionSide } : {}),
  };
}

export function toLibraryItem(purchase: StoredPurchase, live: LiveBriefMark | null): BriefLibraryItem | null {
  if (purchase.brief === null) return null;
  const author = defaultBriefAuthor(purchase.author ?? purchase.brief.author);
  const written = purchase.yesCents ?? purchase.brief.evidence?.yesCentsWhenWritten ?? yesCentsFromBrief(purchase.brief);
  const resolved = live === null ? null : resolutionFromStatus(live.eventStatus, live.contractStatus, live.resolutionSide);
  const liveYes = resolved === "yes" ? 100 : resolved === "no" ? 0 : (live?.yesCents ?? null);
  const item: BriefLibraryItem = {
    id: purchase.receipt.signature,
    symbol: purchase.symbol,
    title: purchase.brief.headline,
    category: live?.category ?? purchase.brief.evidence?.category ?? "Market",
    writtenAt: new Date(purchase.atMs).toISOString(),
    author,
    costCents: purchase.receipt.costCents,
    signature: purchase.receipt.signature,
    explorerUrl: purchase.receipt.explorerUrl,
    yesCentsWhenWritten: written,
    yesCentsNow: liveYes,
    needsRefresh: needsRefresh(oddsDeltaPoints(written, liveYes), resolved),
    resolved,
    marketState: live?.marketState ?? null,
    eventTitle: live?.eventTitle ?? null,
    contractLabel: live?.contractLabel ?? null,
    brief: purchase.brief,
  };
  return item;
}

export async function buildBriefLibrary(options: {
  readonly purchases: readonly StoredPurchase[];
  readonly getEvent: EventLookup;
  readonly now: Date;
}): Promise<BriefLibraryView> {
  const events = new Map<string, MarketEvent | null>();
  const tickers = [...new Set(options.purchases.flatMap((purchase) => {
    const parsed = parseInstrumentSymbol(purchase.symbol);
    return parsed === undefined ? [] : [parsed.eventTicker];
  }))];
  await Promise.all(tickers.map(async (ticker) => {
    const result = await options.getEvent(ticker);
    events.set(ticker, result.ok ? result.value : null);
  }));
  const items = options.purchases
    .flatMap((purchase) => {
      const parsed = parseInstrumentSymbol(purchase.symbol);
      const event = parsed === undefined ? null : (events.get(parsed.eventTicker) ?? null);
      const live = event === null ? null : liveMarkFromEvent(event, purchase.symbol);
      const item = toLibraryItem(purchase, live);
      return item === null ? [] : [item];
    })
    .sort((left, right) => Date.parse(right.writtenAt) - Date.parse(left.writtenAt));
  return {
    generatedAt: options.now.toISOString(),
    items,
    stats: libraryStats(items),
  };
}
