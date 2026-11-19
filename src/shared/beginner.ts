import { formatVolumeUsd, friendlyEventTitle } from "@/shared";
import type { ResearchBrief, ResearchPostContext, ResearchSeriesPoint, ResearchTimeframe, ResearchView } from "@/shared";

export const BEGINNER_TIMEFRAMES = ["1D", "1W", "1M", "All"] as const;
export type BeginnerTimeframe = (typeof BEGINNER_TIMEFRAMES)[number];

export function isBeginnerTimeframe(value: ResearchTimeframe): value is BeginnerTimeframe {
  return (BEGINNER_TIMEFRAMES as readonly string[]).includes(value);
}

const ZONE = "America/Chicago";
const MIN_MOVE_CENTS = 3;
const MAX_MOVES = 4;
const POST_ATTACH_MS = 12 * 60 * 60 * 1000;
const NEAR_EXPIRY_DAYS = 7;
const YES_STILL_OPEN = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

const SAFE_HOSTS = new Set(["assets.gemini.com", "www.gemini.com", "gemini.com"]);

export function safeHttpsUrl(value: string | null | undefined, hosts?: ReadonlySet<string>): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = URL.parse(value.trim());
  if (parsed === null || parsed.protocol !== "https:") return null;
  const host = parsed.hostname.replace(/^www\./u, "").toLowerCase();
  const allowed = hosts ?? SAFE_HOSTS;
  if (![parsed.hostname.toLowerCase(), host].some((candidate) => allowed.has(candidate))) return null;
  return parsed.toString();
}

export function marketTitle(view: ResearchView, now = new Date()): string {
  return friendlyEventTitle(view.market.eventTitle, view.market.expiryDate, now, ZONE);
}

export function dayChangeCents(view: ResearchView): number | null {
  return view.indicators.recentMove.dayCents;
}

export function crowdSentence(view: ResearchView, now = new Date()): string | null {
  const yes = view.market.prices.buyYesCents;
  if (yes === null) return null;
  const rounded = Math.round(yes);
  const title = marketTitle(view, now).replace(/[?]+$/u, "");
  const lead = `The crowd thinks there's a ${String(rounded)}% chance ${title}.`;
  const change = dayChangeCents(view);
  if (change === null) return lead;
  const yesterday = Math.round(yes - change);
  if (change === 0) return `${lead} That's unchanged from yesterday.`;
  const direction = change > 0 ? "up" : "down";
  return `${lead} That's ${direction} from ${String(yesterday)}% yesterday.`;
}

export function formatEndLine(expiryIso: string | null, nowMs: number): { readonly ends: string | null; readonly daysLeft: string | null } {
  if (expiryIso === null) return { ends: null, daysLeft: null };
  const expiryMs = Date.parse(expiryIso);
  if (!Number.isFinite(expiryMs)) return { ends: null, daysLeft: null };
  const ends = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(expiryMs));
  const remaining = expiryMs - nowMs;
  if (remaining <= 0) return { ends: `Ended ${ends}`, daysLeft: "Ended" };
  const days = Math.floor(remaining / DAY_MS);
  if (days >= 1) return { ends: `Ends ${ends}`, daysLeft: `${String(days)} day${days === 1 ? "" : "s"} left` };
  const hours = Math.max(1, Math.round(remaining / (60 * 60 * 1000)));
  return { ends: `Ends ${ends}`, daysLeft: `${String(hours)} hour${hours === 1 ? "" : "s"} left` };
}

export function volumeLabel(volume: number | null): string | null {
  return volume === null ? null : `${formatVolumeUsd(volume)} vol.`;
}

export interface CrowdMove {
  readonly index: number;
  readonly t: number;
  readonly title: string;
  readonly source: string;
  readonly deltaCents: number;
}

function formatShortDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" }).format(new Date(ms));
}

function moveTitle(delta: number): string {
  const points = Math.round(Math.abs(delta));
  const noun = points === 1 ? "point" : "points";
  return `Yes odds moved ${delta >= 0 ? "▲" : "▼"} ${String(points)} ${noun}`;
}

function postSource(post: ResearchPostContext, t: number): string {
  const when = post.atMs !== null ? formatShortDate(post.atMs) : formatShortDate(t);
  if (post.source === "x-feed") {
    const who = post.author !== null && post.author !== "" ? `${post.author} ` : "";
    return `Matched X post · ${who}${when}`.trim();
  }
  return `News · ${when}`;
}

function postTitle(post: ResearchPostContext): string {
  const text = post.text.replace(/\s+/g, " ").trim();
  if (post.author !== null && post.author !== "") {
    const snippet = text.length <= 80 ? text : `${text.slice(0, 77).trimEnd()}…`;
    return `${post.author}: ${snippet}`;
  }
  return text.length <= 96 ? text : `${text.slice(0, 93).trimEnd()}…`;
}

function significantMoves(points: readonly ResearchSeriesPoint[]): readonly { readonly index: number; readonly delta: number }[] {
  if (points.length < 2) return [];
  const found: { index: number; delta: number }[] = [];
  let anchor = 0;
  for (let index = 1; index < points.length; index += 1) {
    const current = points[index]?.cents;
    const start = points[anchor]?.cents;
    if (current === undefined || start === undefined) continue;
    const last = index === points.length - 1;
    const next = points[index + 1]?.cents;
    const delta = current - start;
    const turning = next === undefined || last || (delta > 0 && next < current) || (delta < 0 && next > current);
    if (turning && Math.abs(delta) >= MIN_MOVE_CENTS) {
      found.push({ index, delta });
      anchor = index;
    }
  }
  return [...found]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.index - b.index)
    .slice(0, MAX_MOVES)
    .sort((a, b) => a.index - b.index);
}

export function crowdMoves(points: readonly ResearchSeriesPoint[], posts: readonly ResearchPostContext[]): readonly CrowdMove[] {
  const moves = significantMoves(points);
  const used = new Set<number>();
  const events: CrowdMove[] = [];
  for (const move of moves) {
    const point = points[move.index];
    if (point === undefined) continue;
    let attached: ResearchPostContext | undefined;
    let attachedAt: number | undefined;
    let best = POST_ATTACH_MS + 1;
    posts.forEach((post, postIndex) => {
      if (post.atMs === null || used.has(postIndex)) return;
      const distance = Math.abs(post.atMs - point.t);
      if (distance <= POST_ATTACH_MS && distance < best) {
        best = distance;
        attached = post;
        attachedAt = postIndex;
      }
    });
    if (attachedAt !== undefined) used.add(attachedAt);
    events.push({
      index: move.index,
      t: point.t,
      title: attached === undefined ? moveTitle(move.delta) : postTitle(attached),
      source: attached === undefined ? `Gemini price history · ${formatShortDate(point.t)}` : postSource(attached, point.t),
      deltaCents: move.delta,
    });
  }
  posts.forEach((post, postIndex) => {
    if (used.has(postIndex) || post.atMs === null) return;
    const index = nearestPointIndex(points, post.atMs);
    if (index === null) return;
    const point = points[index];
    if (point === undefined) return;
    const prior = points[Math.max(0, index - 1)];
    const delta = prior === undefined ? 0 : point.cents - prior.cents;
    events.push({
      index,
      t: point.t,
      title: postTitle(post),
      source: postSource(post, point.t),
      deltaCents: delta,
    });
  });
  return events.sort((a, b) => a.t - b.t || a.index - b.index);
}

function nearestPointIndex(points: readonly ResearchSeriesPoint[], atMs: number): number | null {
  if (points.length === 0) return null;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.abs(point.t - atMs);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return bestDistance === Number.POSITIVE_INFINITY ? null : best;
}

export interface Resolution {
  readonly yesIf: string | null;
  readonly priceSource: string | null;
  readonly payout: string;
  readonly caveat: string | null;
  readonly rulesUrl: string | null;
  readonly hasRules: boolean;
}

const PAYOUT = "$1 per contract if you are right, $0 if you are wrong";

const YES_IF_LEAD = /(?:resolves?\s+to\s+yes\s+if|will\s+resolve\s+to\s+yes\s+if|yes\s+if)\s+(.{8,280}?)(?:\.(?:\s|$)|$)/iu;
const YES_IF_TRAIL = /If\s+(.{8,280}?),\s+this market will resolve to Yes/iu;
const SOURCE_PATTERNS = [
  /(?:verified against|outcome verified against)\s+(?:the\s+)?(.{4,160}?)(?:\.|$)/iu,
  /(?:settlement(?:\s+price)?(?:\s+is)?|price source|as published by|according to|using the|based on the)\s+(.{4,160}?)(?:\.|$)/iu,
  /(?:the underlying is|underlying is)\s+(.{4,160}?)(?:\.|$)/iu,
] as const;
const SNAPSHOT_PATTERN = /\b(?:as of\s+\d|traded price prior|official (?:spot |closing )?price|price (?:of|is|at)\b.{0,200}?\bat\s+\d)/iu;

function cleanClause(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[[\]*_]/g, "").trim().replace(/[;:,]+$/u, "");
}

export function parseResolution(rulesText: string, termsLink: string | null): Resolution {
  const rules = rulesText.replace(/\s+/g, " ").trim();
  const yesMatch = YES_IF_LEAD.exec(rules) ?? YES_IF_TRAIL.exec(rules);
  let sourceMatch: RegExpExecArray | null = null;
  for (const pattern of SOURCE_PATTERNS) {
    sourceMatch = pattern.exec(rules);
    if (sourceMatch !== null) break;
  }
  const yesIf = yesMatch?.[1] === undefined ? null : cleanClause(yesMatch[1]);
  const priceSource = sourceMatch?.[1] === undefined ? null : cleanClause(sourceMatch[1]);
  const snapshot = SNAPSHOT_PATTERN.test(rules);
  return {
    yesIf,
    priceSource,
    payout: PAYOUT,
    caveat: snapshot
      ? "Only the official price at that exact time counts. A move earlier or later does not decide the market by itself."
      : rules === ""
        ? null
        : "This is a short reading of Gemini's rules, not the official legal text.",
    rulesUrl: safeHttpsUrl(termsLink),
    hasRules: rules !== "",
  };
}

export type TrustTone = "good" | "caution" | "neutral";

export interface TrustLine {
  readonly kind: "activity" | "spread" | "jumpiness";
  readonly tone: TrustTone;
  readonly text: string;
}

function spreadCents(view: ResearchView): number | null {
  const { bestBidCents, bestAskCents, buyYesCents, sellYesCents } = view.market.prices;
  if (bestBidCents !== null && bestAskCents !== null && bestAskCents >= bestBidCents) return Math.round((bestAskCents - bestBidCents) * 10) / 10;
  if (buyYesCents !== null && sellYesCents !== null && buyYesCents >= sellYesCents) return Math.round((buyYesCents - sellYesCents) * 10) / 10;
  return null;
}

export function trustOdds(view: ResearchView): readonly TrustLine[] {
  const lines: TrustLine[] = [];
  const total = volumeLabel(view.market.volume);
  const day = view.market.volume24h === null ? null : formatVolumeUsd(view.market.volume24h);
  if (total !== null || day !== null) {
    const thin = (view.market.volume24h ?? view.market.volume ?? 0) < 1000;
    const parts = [
      total === null ? null : `${total.replace(/ vol\.$/u, "")} traded in total`,
      day === null ? null : `${day} in the last 24 hours`,
    ].filter((part) => part !== null);
    lines.push({
      kind: "activity",
      tone: thin ? "caution" : "good",
      text: `${thin ? "Light activity" : "Good activity"}: ${parts.join(", ")}`,
    });
  }
  if (view.data.book === "unavailable" && spreadCents(view) === null) {
    lines.push({ kind: "spread", tone: "caution", text: "The order book isn't available, so we can't measure the spread right now." });
  } else {
    const spread = spreadCents(view);
    if (spread !== null) {
      const tight = spread <= 3;
      lines.push({
        kind: "spread",
        tone: tight ? "good" : "caution",
        text: tight
          ? `Tight spread: buy and sell prices are ${String(spread)}¢ apart`
          : `Wide spread: buy and sell prices are ${String(spread)}¢ apart`,
      });
    }
  }
  const move = dayChangeCents(view);
  if (move !== null) {
    const points = Math.round(Math.abs(move));
    if (points === 0) {
      lines.push({ kind: "jumpiness", tone: "good", text: "Steady: Yes odds are unchanged from yesterday" });
    } else if (points <= 2) {
      lines.push({ kind: "jumpiness", tone: "good", text: `Steady: moved ${String(points)} point${points === 1 ? "" : "s"} in a day` });
    } else {
      lines.push({ kind: "jumpiness", tone: "caution", text: `Jumpy: moved ${String(points)} points in a day` });
    }
  } else if (view.indicators.jumpiness.reading !== "") {
    lines.push({ kind: "jumpiness", tone: "neutral", text: view.indicators.jumpiness.reading });
  }
  return lines;
}

const STRIKE_AFTER = /(?:above|over|greater than|below|under|less than|at least|at or above|at or below)\s+\$?\s*(\d[\d,]*(?:\.\d+)?)/iu;
const STRIKE_BEFORE = /\$\s*(\d[\d,]*(?:\.\d+)?)\s+or\s+(?:above|over|more|higher|greater)/iu;

export interface DriverLists {
  readonly up: readonly string[];
  readonly down: readonly string[];
}

export function marketDrivers(resolution: Resolution, view: ResearchView, nowMs: number): DriverLists | null {
  const up: string[] = [];
  const down: string[] = [];
  const clause = [resolution.yesIf, view.market.rulesText].filter((part) => part !== null && part !== "").join(" ");
  const strikeAfter = STRIKE_AFTER.exec(clause);
  const strikeBefore = STRIKE_BEFORE.exec(clause);
  const strike = strikeAfter ?? strikeBefore;
  if (strike?.[0] !== undefined && strike[1] !== undefined) {
    const raw = strikeAfter !== null
      ? strike[0].replace(/\s+/g, " ").trim()
      : `at or above $${strike[1]}`;
    const lower = raw.toLowerCase();
    const rising = lower.includes("above") || lower.includes("over") || lower.includes("greater") || lower.includes("at least") || lower.includes("at or above");
    if (rising) {
      up.push(`The settlement price finishing ${raw}`);
      down.push(`The settlement price finishing at or below $${strike[1]}`);
    } else {
      down.push(`The settlement price finishing ${raw}`);
      up.push(`The settlement price finishing at or above $${strike[1]}`);
    }
  }
  const expiry = view.market.expiryDate === null ? Number.NaN : Date.parse(view.market.expiryDate);
  const daysLeft = Number.isFinite(expiry) ? (expiry - nowMs) / DAY_MS : null;
  const yes = view.market.prices.buyYesCents;
  if (daysLeft !== null && daysLeft > 0 && daysLeft <= NEAR_EXPIRY_DAYS && yes !== null && yes < YES_STILL_OPEN && strike !== null) {
    down.push(`Time running out with Yes still at ${String(Math.round(yes))}%`);
  }
  if (up.length === 0 && down.length === 0) return null;
  return { up, down };
}

export function yesCentsFromBrief(brief: ResearchBrief): number | null {
  const text = [brief.headline, ...brief.sections.map((section) => section.body)].join("\n");
  const match = /(?:costs|priced at)\s+(\d+(?:\.\d+)?)¢/iu.exec(text);
  if (match?.[1] === undefined) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function briefStaleCopy(purchasedAtMs: number, purchasedYesCents: number | null, currentYesCents: number | null): { readonly summary: string; readonly needsRefresh: boolean } {
  const bought = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" }).format(new Date(purchasedAtMs));
  if (purchasedYesCents === null || currentYesCents === null) {
    return { summary: `Bought ${bought}.`, needsRefresh: false };
  }
  const delta = Math.round(currentYesCents - purchasedYesCents);
  const points = Math.abs(delta);
  const moved = points === 0
    ? `Bought ${bought} at ${String(Math.round(purchasedYesCents))}%. Odds have not moved since.`
    : `Bought ${bought} at ${String(Math.round(purchasedYesCents))}%. Odds have moved ${String(points)} point${points === 1 ? "" : "s"} since.`;
  return { summary: moved, needsRefresh: points >= 5 };
}

export const STAKE_OPTIONS_CENTS = [100, 200, 500] as const;
