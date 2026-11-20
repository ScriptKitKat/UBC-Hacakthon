import { z } from "zod";
import type { LlmCompleter } from "@/features/llm";
import { BRIEF_SECTION_TITLES } from "@/shared";
import type { ResearchBrief, ResearchRelatedContract, ResearchView } from "@/shared";

const RELATED_LIMIT = 3;
const POST_EXCERPT_CHARS = 240;
const RULES_EXCERPT_CHARS = 280;
const LEAN_UPPER_SHARE = 55;
const LEAN_LOWER_SHARE = 45;
const PERCENT = 100;

const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?/g;
const NUMBER_WORDS = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|double|triple)\b/gi;

const polishedSchema = z.object({ headline: z.string().min(1), sections: z.array(z.string().min(1)) });

const POLISH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "sections"],
  properties: { headline: { type: "string" }, sections: { type: "array", items: { type: "string" } } },
} as const;

const POLISH_SYSTEM = [
  "You polish a research brief about a prediction market for a trader.",
  "Rewrite the headline and each section body so it reads smoothly, keeping every fact.",
  "Use only numbers that already appear in the draft; never add, round, convert or compute new numbers.",
  "No advice, no hype, no emoji. Return the sections in the same order and count as the draft.",
].join(" ");

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function cents(value: number | null): string {
  return value === null ? "not available" : `${String(round(value))}¢`;
}

function signedCents(value: number): string {
  return `${value > 0 ? "+" : ""}${String(round(value))}¢`;
}

function count(value: number | null, noun: string): string {
  return value === null ? "not available" : `${round(value, 0).toLocaleString("en-US")} ${noun}`;
}

function excerpt(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit).trimEnd()}…`;
}

function momentumInWords(zone: ResearchView["indicators"]["momentum"]["zone"]): string {
  switch (zone) {
    case "overbought": return "odds have mostly risen recently";
    case "oversold": return "odds have mostly fallen recently";
    case "neutral":
    case null: return "no strong push up or down";
    default: {
      const exhaustive: never = zone;
      return exhaustive;
    }
  }
}

function headline(view: ResearchView): string {
  const { market } = view;
  const price = market.prices.buyYesCents;
  const stance = price === null ? "has no live price right now" : `is priced at ${cents(price)} for YES`;
  const title = market.eventTitle.trim().replace(/[?!.:;,\s]+$/u, "");
  return `${title}: ${market.contractLabel} ${stance}`;
}

function thinks(view: ResearchView): string {
  const { prices } = view.market;
  const yes = prices.buyYesCents;
  const lead = yes === null
    ? "The market has no live YES price, so there is no current read on the odds."
    : `Buying YES costs ${cents(yes)}, which the market reads as roughly a ${String(round(yes, 0))}% chance. Buying NO costs ${cents(prices.buyNoCents)}.`;
  return `${lead} Best bid is ${cents(prices.bestBidCents)}, best ask is ${cents(prices.bestAskCents)}, and the last trade was at ${cents(prices.lastTradeCents)}.`;
}

function changed(view: ResearchView): string {
  const { recentMove, momentum, volumeSpike } = view.indicators;
  const move = (label: string, value: number | null) => value === null ? `${label}: not enough history to measure` : `${label}: ${signedCents(value)}`;
  const parts = [`${move("Last hour", recentMove.hourCents)}; ${move("last day", recentMove.dayCents)}.`];
  parts.push(
    momentum.value === null
      ? "Momentum can't be measured yet."
      : `Momentum reads ${String(round(momentum.value, 0))} out of 100: ${momentumInWords(momentum.zone)}.`,
  );
  if (volumeSpike.ratio !== null) {
    parts.push(`Latest-hour volume is ${String(round(volumeSpike.ratio))} times its usual level${volumeSpike.obvTrend === null ? "" : `, with volume flowing ${volumeSpike.obvTrend === "flat" ? "evenly" : volumeSpike.obvTrend}`}.`);
  } else {
    parts.push("There isn't enough volume history to say whether trading is unusually busy.");
  }
  return parts.join(" ");
}

function bookLean(view: ResearchView): string {
  const bids = view.book.bids.reduce((total, level) => total + level.amount, 0);
  const asks = view.book.asks.reduce((total, level) => total + level.amount, 0);
  if (view.data.book === "unavailable" || bids + asks === 0) return "The order book is unavailable, so there is no read on buyer versus seller pressure.";
  const share = round((bids / (bids + asks)) * PERCENT, 0);
  const lean = share >= LEAN_UPPER_SHARE ? "leans toward buyers" : share <= LEAN_LOWER_SHARE ? "leans toward sellers" : "is roughly balanced";
  return `Resting orders total ${count(bids, "contracts")} bid against ${count(asks, "contracts")} offered, so ${String(share)}% of the visible book sits on the bid side and the book ${lean}.`;
}

function tradeFlow(view: ResearchView): string {
  const { trades } = view;
  if (view.data.trades === "unavailable" || trades.length === 0) return "Recent trades are unavailable.";
  const buys = trades.filter((trade) => trade.side === "buy").length;
  const latest = trades.reduce((newest, trade) => (trade.timeMs > newest.timeMs ? trade : newest));
  return `Of the last ${String(trades.length)} trades, ${String(buys)} were buys and ${String(trades.length - buys)} were sells; the most recent was a ${latest.side} at ${cents(latest.priceCents)}.`;
}

function crowd(view: ResearchView): string {
  const { volume, volume24h } = view.market;
  return `Total volume is ${count(volume, "contracts")}; the last 24 hours saw ${count(volume24h, "contracts")}. ${bookLean(view)} ${tradeFlow(view)}`;
}

function relatedLine(item: ResearchRelatedContract, withEvent: boolean): string {
  const name = withEvent ? `${item.eventTitle} — ${item.contractLabel}` : item.contractLabel;
  return `${name} (YES ${cents(item.yesCents)})`;
}

function related(view: ResearchView): string {
  const { sameEvent, sameCategory } = view.related;
  if (sameEvent.length === 0 && sameCategory.length === 0) return "No related markets were found.";
  return [
    sameEvent.length === 0 ? undefined : `Same event: ${sameEvent.slice(0, RELATED_LIMIT).map((item) => relatedLine(item, false)).join("; ")}.`,
    sameCategory.length === 0 ? undefined : `Same category: ${sameCategory.slice(0, RELATED_LIMIT).map((item) => relatedLine(item, true)).join("; ")}.`,
  ].filter((part) => part !== undefined).join(" ");
}

function catalysts(view: ResearchView): string {
  const { postContext, market } = view;
  const post = postContext === null
    ? "No post or news item is attached to this market."
    : `The ${postContext.source === "x-feed" ? "X post" : "news item"}${postContext.author === null ? "" : ` from ${postContext.author}`} that matched this market says: “${excerpt(postContext.text, POST_EXCERPT_CHARS)}”${postContext.why === null ? "" : ` It matched because: ${postContext.why}`}`;
  const expiry = market.expiryDate === null ? "No expiry date is listed." : `It expires on ${market.expiryDate.slice(0, 10)}.`;
  const rules = market.rulesText.trim() === "" ? "No resolution rules were provided." : `Resolution rules: ${excerpt(market.rulesText, RULES_EXCERPT_CHARS)}`;
  return `${post} ${expiry} ${rules}`;
}

function risks(view: ResearchView): string {
  const { data, series } = view;
  const notes = [
    data.event === "stale" ? "Gemini wasn't responding, so prices and details are the last ones the desk saw." : undefined,
    data.candles === "unavailable" ? "Gemini's price history was unavailable." : undefined,
    series.points.length === 0
      ? "There is no price history for this market yet."
      : `The price series has ${String(series.points.length)} points from ${series.source === "mixed" ? "Gemini candles and desk snapshots" : series.source}.`,
    data.book === "unavailable" ? "The order book was unavailable." : undefined,
    data.trades === "unavailable" ? "Recent trades were unavailable." : undefined,
    "This brief only knows Gemini market data and the attached post; it knows nothing about breaking news, polls or events elsewhere, and it is not financial advice.",
  ];
  return notes.filter((note) => note !== undefined).join(" ");
}

export function composeBrief(view: ResearchView): ResearchBrief {
  const bodies = [thinks(view), changed(view), crowd(view), related(view), catalysts(view), risks(view)];
  return {
    symbol: view.symbol,
    generatedAt: view.generatedAt,
    headline: headline(view),
    sections: BRIEF_SECTION_TITLES.map((title, index) => ({ title, body: bodies[index] ?? "" })),
    polishedBy: "template",
  };
}

function normalizedNumber(token: string): string {
  return String(Number(token.replaceAll(",", "")));
}

function numbersIn(text: string): ReadonlySet<string> {
  const digits = (text.match(NUMBER_PATTERN) ?? []).map(normalizedNumber);
  const words = (text.match(NUMBER_WORDS) ?? []).map((word) => word.toLowerCase());
  return new Set([...digits, ...words]);
}

function briefText(brief: Pick<ResearchBrief, "headline" | "sections">): string {
  return [brief.headline, ...brief.sections.map((section) => section.body)].join("\n");
}

export async function polishBrief(template: ResearchBrief, llm: LlmCompleter | undefined): Promise<ResearchBrief> {
  if (!llm) return template;
  let raw: unknown;
  try {
    raw = await llm.complete({
      system: POLISH_SYSTEM,
      user: JSON.stringify({ headline: template.headline, sections: template.sections.map((section) => section.body) }),
      schemaName: "brief_polish",
      schema: POLISH_JSON_SCHEMA,
    });
  } catch {
    return template;
  }
  const parsed = polishedSchema.safeParse(raw);
  if (!parsed.success || parsed.data.sections.length !== template.sections.length) return template;
  const polished = {
    headline: parsed.data.headline,
    sections: template.sections.map((section, index) => ({ title: section.title, body: parsed.data.sections[index] ?? section.body })),
  };
  const allowed = numbersIn(briefText(template));
  if ([...numbersIn(briefText(polished))].some((token) => !allowed.has(token))) return template;
  return { ...template, ...polished, polishedBy: llm.provider };
}
