import { formatVolumeUsd, parseResolution, safeHttpsUrl } from "@/shared";
import type { BriefEvidence, ResearchBrief, ResearchPostContext, ResearchView } from "@/shared";

const ZONE = "America/Chicago";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MOVE_POINTS = 3;
const ATTACH_MS = 12 * 60 * 60 * 1000;
const POST_EXCERPT = 180;

function round(value: number, places = 0): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function percent(value: number): string {
  return `${String(Math.round(value))}%`;
}

function excerpt(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit).trimEnd()}…`;
}

function formatShortDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" }).format(new Date(ms));
}

function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function headline(view: ResearchView): string {
  const { market } = view;
  const price = market.prices.buyYesCents;
  const title = market.eventTitle.trim().replace(/[?!.:;,\s]+$/u, "");
  if (price === null) return `${title}: ${market.contractLabel}`;
  return `${title}: ${market.contractLabel} is priced at ${String(round(price))}¢ for YES`;
}

function postsIn(view: ResearchView): ResearchPostContext[] {
  const seen = new Set<string>();
  const posts: ResearchPostContext[] = [];
  for (const post of [view.postContext, ...view.matchedPosts]) {
    if (post === null) continue;
    const key = post.url ?? post.text;
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(post);
  }
  return posts;
}

function daysLeft(expiryIso: string | null, nowMs: number): { readonly label: string; readonly value: string } | null {
  if (expiryIso === null) return null;
  const expiryMs = Date.parse(expiryIso);
  if (Number.isNaN(expiryMs)) return null;
  const remaining = expiryMs - nowMs;
  if (remaining <= 0) return { label: "Days left", value: "Ended" };
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
  if (days > 0) return { label: "Days left", value: `${String(days)}d ${String(hours)}h` };
  const minutes = Math.max(1, Math.floor((remaining % HOUR_MS) / (60 * 1000)));
  if (hours > 0) return { label: "Time left", value: `${String(hours)}h ${String(minutes)}m` };
  return { label: "Time left", value: `${String(minutes)}m` };
}

function midCents(view: ResearchView): number | null {
  const { bestBidCents, bestAskCents, lastTradeCents, buyYesCents } = view.market.prices;
  if (lastTradeCents !== null) return lastTradeCents;
  if (bestBidCents !== null && bestAskCents !== null) return (bestBidCents + bestAskCents) / 2;
  return buyYesCents;
}

function depthNear(view: ResearchView): { readonly bid: number; readonly ask: number } | null {
  if (view.data.book === "unavailable") return null;
  const mid = midCents(view);
  if (mid === null || (view.book.bids.length === 0 && view.book.asks.length === 0)) return null;
  const bid = view.book.bids.filter((level) => level.priceCents >= mid - 5).reduce((sum, level) => sum + level.amount, 0);
  const ask = view.book.asks.filter((level) => level.priceCents <= mid + 5).reduce((sum, level) => sum + level.amount, 0);
  return { bid, ask };
}

function keyNumbers(view: ResearchView, nowMs: number): BriefEvidence["keyNumbers"] {
  const { prices, volume, volume24h } = view.market;
  const rows: NonNullable<BriefEvidence["keyNumbers"]> = [];
  if (prices.buyYesCents !== null) rows.push({ label: "Implied YES", value: percent(prices.buyYesCents) });
  if (prices.bestBidCents !== null && prices.bestAskCents !== null) {
    rows.push({ label: "Spread", value: `${String(round(prices.bestAskCents - prices.bestBidCents, 1))}¢` });
  }
  if (volume24h !== null) rows.push({ label: "Daily volume", value: formatVolumeUsd(volume24h) });
  if (volume !== null) rows.push({ label: "Volume", value: formatVolumeUsd(volume) });
  const remaining = daysLeft(view.market.expiryDate, nowMs);
  if (remaining) rows.push(remaining);
  const depth = depthNear(view);
  if (depth) rows.push({ label: "Depth ±5¢", value: `${round(depth.bid, 1).toLocaleString("en-US")} bid · ${round(depth.ask, 1).toLocaleString("en-US")} ask` });
  if (view.data.trades === "live" && view.trades.length > 0) {
    rows.push({ label: "Recent prints", value: String(view.trades.length) });
  }
  if (view.indicators.momentum.value !== null) {
    rows.push({ label: "Momentum", value: String(round(view.indicators.momentum.value, 0)) });
  }
  return rows.length === 0 ? undefined : rows;
}

function movesFromSeries(view: ResearchView): BriefEvidence["moves"] {
  const points = view.series.points;
  if (points.length < 2) return undefined;
  const datedPosts = postsIn(view).filter((post): post is ResearchPostContext & { atMs: number } => post.atMs !== null);
  const rows: NonNullable<BriefEvidence["moves"]> = [];
  let anchor = points[0]?.cents;
  if (anchor === undefined) return undefined;
  for (const point of points.slice(1)) {
    const delta = Math.round(point.cents) - Math.round(anchor);
    if (Math.abs(delta) < MOVE_POINTS) continue;
    const post = datedPosts.find((candidate) => Math.abs(candidate.atMs - point.t) <= ATTACH_MS);
    const note = post === undefined
      ? `Yes odds moved ${delta > 0 ? "+" : ""}${String(delta)} points.`
      : excerpt(post.text, POST_EXCERPT);
    rows.push({ atMs: point.t, points: delta, note });
    anchor = point.cents;
  }
  return rows.length === 0 ? undefined : rows;
}

function upcomingFromExpiry(view: ResearchView): BriefEvidence["upcoming"] {
  if (view.market.expiryDate === null) return undefined;
  const atMs = Date.parse(view.market.expiryDate);
  if (Number.isNaN(atMs)) return undefined;
  return [{ atMs, label: "Resolution snapshot", importance: "Final" }];
}

function crowdFromView(view: ResearchView): BriefEvidence["crowd"] {
  const rows: NonNullable<BriefEvidence["crowd"]> = [];
  if (view.market.prices.buyYesCents !== null) {
    rows.push({ label: "Buy YES share", value: percent(view.market.prices.buyYesCents) });
  }
  if (view.market.volume24h !== null) rows.push({ label: "Daily volume", value: formatVolumeUsd(view.market.volume24h) });
  if (view.market.volume !== null) rows.push({ label: "Volume", value: formatVolumeUsd(view.market.volume) });
  const depth = depthNear(view);
  if (depth) {
    const total = depth.bid + depth.ask;
    if (total > 0) rows.push({ label: "Bid share near mid", value: percent((depth.bid / total) * 100) });
  }
  return rows.length === 0 ? undefined : rows;
}

function httpsUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = URL.parse(value.trim());
  if (parsed === null || parsed.protocol !== "https:" || parsed.hostname.trim() === "") return null;
  return parsed.toString();
}

function sourcesFromView(view: ResearchView): BriefEvidence["sources"] {
  const rows: NonNullable<BriefEvidence["sources"]> = [];
  const seen = new Set<string>();
  const push = (title: string, url: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    rows.push({ title, url });
  };
  const terms = httpsUrl(view.market.termsLink) ?? safeHttpsUrl(view.market.termsLink);
  if (terms !== null) push("Official market terms", terms);
  for (const post of postsIn(view)) {
    const url = httpsUrl(post.url);
    if (url === null) continue;
    const who = post.author === null || post.author.trim() === "" ? "Matched post" : post.author;
    push(who, url);
  }
  return rows.length === 0 ? undefined : rows;
}

function bottomLine(view: ResearchView, nowMs: number): string | undefined {
  const yes = view.market.prices.buyYesCents;
  if (yes === null) return undefined;
  const remaining = daysLeft(view.market.expiryDate, nowMs);
  const when = formatShortDate(nowMs);
  const clock = remaining === null
    ? `as of ${when}.`
    : remaining.value === "Ended"
      ? `as of ${when}. The listed expiry has passed.`
      : `as of ${when}, with ${remaining.value} left until the listed expiry.`;
  return `The market prices Yes at ${percent(yes)} ${clock}`;
}

function section(title: string, body: string | undefined): { readonly title: string; readonly body: string } | undefined {
  if (body === undefined || body.trim() === "") return undefined;
  return { title, body };
}

function resolvesBody(view: ResearchView, evidence: BriefEvidence): string | undefined {
  const resolution = evidence.resolution;
  if (resolution === undefined) return undefined;
  const lines = [
    resolution.yesIf === null ? undefined : `YES if: ${resolution.yesIf}`,
    resolution.decidedBy === null ? undefined : `Decided by: ${resolution.decidedBy}`,
    resolution.caveat === null ? undefined : `Watch out for: ${resolution.caveat}`,
  ].filter((line) => line !== undefined);
  return lines.length === 0 ? undefined : lines.join("\n");
}

function keyNumbersBody(rows: BriefEvidence["keyNumbers"]): string | undefined {
  if (rows === undefined || rows.length === 0) return undefined;
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}

function movesBody(rows: BriefEvidence["moves"]): string | undefined {
  if (rows === undefined || rows.length === 0) return undefined;
  return rows.map((row) => `${formatShortDate(row.atMs)} · ${row.points > 0 ? "+" : ""}${String(row.points)} pts · ${row.note}`).join("\n");
}

function upcomingBody(rows: BriefEvidence["upcoming"]): string | undefined {
  if (rows === undefined || rows.length === 0) return undefined;
  return rows.map((row) => `${formatDateTime(row.atMs)} · ${row.importance} · ${row.label}`).join("\n");
}

function crowdBody(rows: BriefEvidence["crowd"]): string | undefined {
  if (rows === undefined || rows.length === 0) return undefined;
  return rows.map((row) => `${row.label}: ${row.value}`).join("\n");
}

function sourcesBody(rows: BriefEvidence["sources"]): string | undefined {
  if (rows === undefined || rows.length === 0) return undefined;
  return rows.map((row) => `${row.title}: ${row.url}`).join("\n");
}

function caseForYes(view: ResearchView, yesIf: string | null): string | undefined {
  const parts: string[] = [];
  const yes = view.market.prices.buyYesCents;
  if (yes !== null) parts.push(`The market prices Yes at ${percent(yes)}.`);
  if (yesIf !== null) parts.push(`The official rule pays Yes if ${yesIf}.`);
  const post = postsIn(view)[0];
  if (post !== undefined) {
    const who = post.author === null || post.author.trim() === "" ? "a matched post" : post.author;
    parts.push(`A datapoint on the desk is ${who} saying “${excerpt(post.text, POST_EXCERPT)}”.`);
  }
  return parts.length === 0 ? undefined : parts.join(" ");
}

function caseForNo(view: ResearchView, yesIf: string | null): string | undefined {
  const parts: string[] = [];
  const yes = view.market.prices.buyYesCents;
  const no = view.market.prices.buyNoCents;
  if (no !== null) parts.push(`Buying No costs ${String(round(no))}¢.`);
  else if (yes !== null) parts.push(`The market leaves ${percent(100 - yes)} off a certain Yes.`);
  if (yesIf !== null) parts.push(`If the official result is not “${yesIf}”, this contract pays No.`);
  return parts.length === 0 ? undefined : parts.join(" ");
}

function historyBody(view: ResearchView): string | undefined {
  const points = view.series.points;
  if (points.length === 0) return undefined;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const source = view.series.source === "mixed" ? "Gemini candles and desk snapshots" : view.series.source === "snapshot" ? "desk snapshots" : "Gemini candles";
  if (points.length === 1) {
    return `The ${source} series has a point at ${formatShortDate(first.t)} with Yes at ${percent(first.cents)}.`;
  }
  return `The ${source} series starts on ${formatShortDate(first.t)} with Yes at ${percent(first.cents)}. The last point is ${percent(last.cents)} on ${formatShortDate(last.t)}, across ${String(points.length)} points.`;
}

function mindBody(view: ResearchView, yesIf: string | null, expiryMs: number | null): string | undefined {
  const parts: string[] = [];
  if (yesIf !== null) {
    parts.push(`A confirmed official reading under the rules (“${yesIf}”) or a confirmed miss would settle the question.`);
  }
  if (expiryMs !== null) {
    parts.push(`The listed expiry is ${formatDateTime(expiryMs)}.`);
  }
  const gaps = [
    view.data.event === "stale" ? "Gemini was stale when this was written, so a fresh quote could change the picture." : undefined,
    view.data.candles === "unavailable" ? "Price history was unavailable, so later candles could change the path." : undefined,
    view.series.points.length === 0 ? "There was no price history on the desk when this was written." : undefined,
  ].filter((line) => line !== undefined);
  parts.push(...gaps);
  return parts.length === 0 ? undefined : parts.join(" ");
}

function buildEvidence(view: ResearchView): BriefEvidence {
  const nowMs = Date.parse(view.generatedAt);
  const parsed = parseResolution(view.market.rulesText, view.market.termsLink);
  const expiryMs = view.market.expiryDate === null ? Number.NaN : Date.parse(view.market.expiryDate);
  const decidedBy = Number.isNaN(expiryMs)
    ? (parsed.priceSource ?? null)
    : [parsed.priceSource, `Listed expiry ${formatDateTime(expiryMs)}`].filter((part) => part !== null && part !== "").join(" · ");
  const evidence: BriefEvidence = {
    yesCentsWhenWritten: view.market.prices.buyYesCents,
  };
  if (view.market.category.trim() !== "") evidence.category = view.market.category;
  const line = bottomLine(view, Number.isNaN(nowMs) ? Date.now() : nowMs);
  if (line !== undefined) evidence.bottomLine = line;
  if (parsed.yesIf !== null || parsed.caveat !== null || decidedBy !== "") {
    evidence.resolution = {
      yesIf: parsed.yesIf,
      decidedBy: decidedBy === "" ? null : decidedBy,
      caveat: parsed.caveat,
    };
  }
  const numbers = keyNumbers(view, Number.isNaN(nowMs) ? Date.now() : nowMs);
  if (numbers !== undefined) evidence.keyNumbers = numbers;
  const moves = movesFromSeries(view);
  if (moves !== undefined) evidence.moves = moves;
  const upcoming = upcomingFromExpiry(view);
  if (upcoming !== undefined) evidence.upcoming = upcoming;
  const crowd = crowdFromView(view);
  if (crowd !== undefined) evidence.crowd = crowd;
  const sources = sourcesFromView(view);
  if (sources !== undefined) evidence.sources = sources;
  return evidence;
}

export function composeLibraryBrief(view: ResearchView): ResearchBrief {
  const evidence = buildEvidence(view);
  const yesIf = evidence.resolution?.yesIf ?? null;
  const expiryMs = view.market.expiryDate === null ? null : Date.parse(view.market.expiryDate);
  const sections = [
    section("How it resolves", resolvesBody(view, evidence)),
    section("Key numbers when written", keyNumbersBody(evidence.keyNumbers)),
    section("What moved the odds", movesBody(evidence.moves)),
    section("Case for YES", caseForYes(view, yesIf)),
    section("Case for NO", caseForNo(view, yesIf)),
    section("Coming up before it resolves", upcomingBody(evidence.upcoming)),
    section("Crowd and sentiment", crowdBody(evidence.crowd)),
    section("History and base rates", historyBody(view)),
    section("What would change the agent's mind", mindBody(view, yesIf, expiryMs !== null && !Number.isNaN(expiryMs) ? expiryMs : null)),
    section("Sources", sourcesBody(evidence.sources)),
  ].filter((row) => row !== undefined);
  return {
    symbol: view.symbol,
    generatedAt: view.generatedAt,
    headline: headline(view),
    sections,
    polishedBy: "template",
    author: "desk",
    evidence,
  };
}
