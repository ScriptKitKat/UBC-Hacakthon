import type { WatchlistCard } from "@/shared";
import { formatEndsOn, formatPercent, pointDelta } from "@/shared";

export type WatchlistFilter = "all" | "moving" | "closing";
export type WatchlistSort = "move" | "closing" | "saved";

const MOVING_POINTS = 5;
const CLOSING_MS = 7 * 24 * 60 * 60 * 1000;

export function sinceSavedPoints(card: Pick<WatchlistCard, "savedYesCents" | "yesCents">): number | null {
  return pointDelta(card.savedYesCents, card.yesCents);
}

export function sinceSavedLabel(card: Pick<WatchlistCard, "savedYesCents" | "yesCents">): string | null {
  if (card.savedYesCents === null) return null;
  const since = sinceSavedPoints(card);
  if (since === null) return null;
  if (since === 0) return "no change since";
  return `${since > 0 ? "up" : "down"} ${String(Math.abs(since))} since`;
}

export function savedAtLabel(card: Pick<WatchlistCard, "savedYesCents" | "yesCents">): string | null {
  if (card.savedYesCents === null) return null;
  const since = sinceSavedLabel(card);
  if (since === null) return `Saved at ${formatPercent(card.savedYesCents)}`;
  return `Saved at ${formatPercent(card.savedYesCents)} · ${since}`;
}

export function todayChangeLabel(points: number | null): string | null {
  if (points === null) return null;
  if (points === 0) return "0 today";
  return `${points > 0 ? "▲" : "▼"} ${String(Math.abs(points))} today`;
}

export function endsMeta(card: Pick<WatchlistCard, "categoryLabel" | "expiryDate" | "status">, timeZone = "America/Chicago"): string {
  if (card.status === "settled") return `${card.categoryLabel} · Settled`;
  if (card.status === "ended") return `${card.categoryLabel} · Ended`;
  const ends = formatEndsOn(card.expiryDate, timeZone);
  return ends === null ? card.categoryLabel : `${card.categoryLabel} · ends ${ends}`;
}

export function isClosingSoon(card: Pick<WatchlistCard, "expiryDate" | "status">, now = new Date()): boolean {
  if (card.status !== "live" || card.expiryDate === null) return false;
  const remaining = Date.parse(card.expiryDate) - now.getTime();
  return Number.isFinite(remaining) && remaining > 0 && remaining <= CLOSING_MS;
}

export function isMoving(card: Pick<WatchlistCard, "todayPoints">): boolean {
  return card.todayPoints !== null && Math.abs(card.todayPoints) >= MOVING_POINTS;
}

function moveScore(points: number | null): number {
  return points === null ? -1 : Math.abs(points);
}

export function filterWatchlist(
  cards: readonly WatchlistCard[],
  options: { readonly filter: WatchlistFilter; readonly search: string; readonly now?: Date },
): WatchlistCard[] {
  const needle = options.search.trim().toLowerCase();
  const now = options.now ?? new Date();
  return cards.filter((card) => {
    if (options.filter === "moving" && !isMoving(card)) return false;
    if (options.filter === "closing" && !isClosingSoon(card, now)) return false;
    if (needle === "") return true;
    const haystack = `${card.eventTitle} ${card.categoryLabel} ${card.eventTicker} ${card.contractLabel}`.toLowerCase();
    return haystack.includes(needle);
  });
}

export function sortWatchlist(cards: readonly WatchlistCard[], sort: WatchlistSort): WatchlistCard[] {
  const copy = [...cards];
  if (sort === "closing") {
    copy.sort((left, right) => {
      const leftTime = left.expiryDate === null ? Number.POSITIVE_INFINITY : Date.parse(left.expiryDate);
      const rightTime = right.expiryDate === null ? Number.POSITIVE_INFINITY : Date.parse(right.expiryDate);
      return leftTime - rightTime;
    });
  } else if (sort === "saved") {
    copy.sort((left, right) => Date.parse(right.savedAt ?? "0") - Date.parse(left.savedAt ?? "0"));
  } else {
    copy.sort((left, right) => moveScore(right.todayPoints) - moveScore(left.todayPoints));
  }
  return copy;
}

export function applyStarToggle(saved: ReadonlySet<string>, keys: readonly string[], nextSaved: boolean): Set<string> {
  const next = new Set(saved);
  for (const key of keys) {
    if (nextSaved) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function isStarred(saved: ReadonlySet<string>, keys: readonly string[]): boolean {
  return keys.some((key) => saved.has(key));
}
