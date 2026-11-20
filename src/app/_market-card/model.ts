import type { BrowseCard, CatalogCard, WatchlistCard } from "@/shared";
import {
  changeTrend,
  formatDeadline,
  formatPayoutFromAsk,
  formatSignedPercent,
  friendlyEventTitle,
  safeHttpsUrl,
} from "@/shared";

export interface MarketCardOutcome {
  readonly key: string;
  readonly label: string;
  readonly percent: number | null;
  readonly payout: string | null;
  readonly href: string;
}

export interface MarketCardChange {
  readonly label: string;
  readonly trend: "up" | "down" | "flat";
}

export interface MarketCardModel {
  readonly category: string;
  readonly title: string;
  readonly href: string;
  readonly iconUrl: string | null;
  readonly monogram: string;
  readonly detail: string | null;
  readonly closes: string | null;
  readonly live: boolean;
  readonly change: MarketCardChange | null;
  readonly outcomes: readonly MarketCardOutcome[];
}

export function marketHref(symbol: string): string {
  return `/markets/${encodeURIComponent(symbol)}`;
}

export function changeLabel(changePercent: number | null): MarketCardChange | null {
  if (changePercent === null) return null;
  return { label: `${formatSignedPercent(changePercent)} 24h`, trend: changeTrend(changePercent) };
}

export function monogramFor(title: string): string {
  return title.replace(/[^A-Za-z0-9]/gu, "").slice(0, 1).toUpperCase() || "M";
}

function yesNoOutcomes(card: CatalogCard, href: string, beginner: boolean): MarketCardOutcome[] {
  return [
    { key: "yes", label: "Yes", percent: card.yesCents, payout: formatPayoutFromAsk(card.yesCents, beginner), href },
    { key: "no", label: "No", percent: card.noCents, payout: formatPayoutFromAsk(card.noCents, beginner), href },
  ];
}

export function catalogCardModel(card: CatalogCard, beginner: boolean): MarketCardModel {
  const title = friendlyEventTitle(card.eventTitle, card.expiryDate);
  const href = marketHref(card.instrumentSymbol);
  return {
    category: card.categoryLabel,
    title,
    href,
    iconUrl: safeHttpsUrl(card.imageUrl),
    monogram: monogramFor(title),
    detail: card.contractLabel === "" ? null : card.contractLabel,
    closes: formatDeadline(card.expiryDate) ?? card.endsIn,
    live: false,
    change: changeLabel(card.changePercent),
    outcomes: yesNoOutcomes(card, href, beginner),
  };
}

export function watchlistCardModel(card: WatchlistCard, beginner: boolean): MarketCardModel {
  const title = friendlyEventTitle(card.eventTitle, card.expiryDate);
  return {
    category: card.categoryLabel,
    title,
    href: card.href,
    iconUrl: safeHttpsUrl(card.imageUrl),
    monogram: monogramFor(title),
    detail: card.contractLabel === "" ? null : card.contractLabel,
    closes: card.status === "settled" ? "Settled" : card.status === "ended" ? "Ended" : formatDeadline(card.expiryDate),
    live: false,
    change: card.status === "live" ? changeLabel(card.changePercent) : null,
    outcomes: yesNoOutcomes(card, card.href, beginner),
  };
}

export function browseCardModel(card: BrowseCard, beginner: boolean): MarketCardModel {
  return {
    category: card.categoryLabel,
    title: card.displayTitle,
    href: card.href,
    iconUrl: safeHttpsUrl(card.imageUrl),
    monogram: monogramFor(card.displayTitle),
    detail: card.spotLabel === null ? null : `Current: ${card.spotLabel}`,
    closes: formatDeadline(card.expiryDate),
    live: card.isLive,
    change: changeLabel(card.changePercent),
    outcomes: card.rows.map((row) => ({
      key: row.instrumentSymbol,
      label: row.label,
      percent: row.yesCents,
      payout: beginner ? row.payoutBeginner : row.payoutPro,
      href: row.href,
    })),
  };
}
