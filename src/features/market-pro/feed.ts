import type { Candle } from "@/features/markets";
import type { DecisionLogEntry, ProFeedItem, ResearchPostContext } from "@/shared";

const HOUR_MS = 60 * 60 * 1000;

export function closeAt(candles: readonly Candle[], timeMs: number): number | null {
  if (candles.length === 0) return null;
  const earlier = [...candles].filter((candle) => candle.timeMs <= timeMs).at(-1);
  return earlier?.closeCents ?? candles[0]?.closeCents ?? null;
}

export function oddsChangeAfter(candles: readonly Candle[], timeMs: number, horizonMs = HOUR_MS): number | null {
  const start = closeAt(candles, timeMs);
  const later = closeAt(candles, timeMs + horizonMs);
  if (start === null || later === null) return null;
  return Math.round((later - start) * 10) / 10;
}

function logItem(entry: DecisionLogEntry, candles: readonly Candle[]): ProFeedItem {
  const timeMs = Date.parse(entry.at);
  const when = Number.isFinite(timeMs) ? timeMs : null;
  const side = entry.outcome === null ? "" : ` ${entry.outcome.toUpperCase()}`;
  const dollars = (entry.notionalCents / 100).toFixed(entry.notionalCents % 100 === 0 ? 0 : 2);
  const action = entry.kind === "approve" ? "Bought" : entry.kind === "needs-approval" ? "Needs approval to buy" : entry.kind === "refuse" ? "Refused" : "Failed";
  return {
    id: entry.entryId,
    timeMs: when,
    source: entry.source === "feed" ? "Feed" : entry.source === "x" ? "X" : "Desk",
    event: `${action}${side} $${dollars}`,
    url: entry.explorerUrl ?? null,
    oddsChangeCents: when === null ? null : oddsChangeAfter(candles, when),
  };
}

function postItem(post: ResearchPostContext, candles: readonly Candle[], nowMs: number): ProFeedItem {
  const handle = post.author === null || post.author.trim() === "" ? null : post.author.replace(/^@/u, "");
  const source = post.source === "x-feed" ? (handle === null ? "X" : `X @${handle}`) : "News";
  return {
    id: `post:${post.url ?? post.text.slice(0, 48)}`,
    timeMs: null,
    source,
    event: post.text.trim(),
    url: post.url,
    oddsChangeCents: oddsChangeAfter(candles, nowMs - HOUR_MS),
  };
}

export function buildFeed(input: {
  readonly log: readonly DecisionLogEntry[];
  readonly symbol: string;
  readonly post: ResearchPostContext | null;
  readonly candles: readonly Candle[];
  readonly nowMs: number;
}): readonly ProFeedItem[] {
  const items: ProFeedItem[] = input.log
    .filter((entry) => entry.symbol === input.symbol)
    .map((entry) => logItem(entry, input.candles));
  if (input.post !== null) items.push(postItem(input.post, input.candles, input.nowMs));
  return items.sort((a, b) => (b.timeMs ?? 0) - (a.timeMs ?? 0)).slice(0, 12);
}
