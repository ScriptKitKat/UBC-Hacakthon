import { describe, expect, it, vi } from "vitest";
import { ok } from "@/features/markets";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import type { LlmCompleter } from "@/features/llm";
import { instrumentSymbol } from "@/shared";
import { loadGrokSettings } from "./env";
import { createPostMatcher } from "./matcher";
import { trimWhy } from "@/features/matcher";
import { MAX_CONTRACTS_PER_EVENT, MAX_EVENTS } from "./candidates";

function contract(symbol: string, label: string, yes = 62): MarketContract {
  return {
    instrumentSymbol: instrumentSymbol(symbol),
    label,
    description: "",
    expiryDate: null,
    marketState: "open",
    status: "active",
    prices: { bestBidCents: yes - 1, bestAskCents: yes, lastTradeCents: yes, buyYesCents: yes, buyNoCents: 100 - yes, sellYesCents: null, sellNoCents: null },
    limits: null,
  };
}

function event(ticker: string, title: string, category: string, contracts: readonly MarketContract[]): MarketEvent {
  return { ticker, title, category, status: "active", expiryDate: null, description: "", subcategory: null, volume: null, volume24h: null, tags: [], contracts };
}

const fed = event("FED261211", "Fed decision in December?", "Economics", [
  contract("GEMI-FED261211-MAINTAIN", "Fed maintains rate"),
  contract("GEMI-FED261211-CUT25", "Cut 25bps", 30),
]);
const pres = event("PRES2028", "Presidential Election Winner 2028?", "Politics", [contract("GEMI-PRES2028-VANCE", "J.D. Vance")]);
const sports = event("NFL-2611221800-KC-BUF-M", "Kansas City vs Buffalo", "Sports", [contract("GEMI-NFL-KC", "Kansas City", 60), contract("GEMI-NFL-BUF", "Buffalo", 40)]);
const unrelatedSports = event("NBA-X", "Charlotte vs Los Angeles", "Sports", [contract("GEMI-NBA-X", "Charlotte")]);
const intraday = event("BTC15M2611180415", "BTC price today at 11:15pm EST", "Crypto", [contract("GEMI-BTC15M", "Up")]);

const FED_POST = { id: "1", text: "Fed officials signal they could hold rates steady at the December FOMC meeting, Powell says" };

function fakeMarkets(events: readonly MarketEvent[] = [fed, pres, sports, unrelatedSports, intraday]) {
  return {
    searchEvents: vi.fn<GeminiMarketsClient["searchEvents"]>((query = {}) => {
      const term = query.search?.toLowerCase();
      const found = events.filter(
        (candidate) =>
          (query.category === undefined || candidate.category === query.category) &&
          (term === undefined || candidate.title.toLowerCase().includes(term)),
      );
      return Promise.resolve(ok({ events: found, total: found.length }));
    }),
  };
}

const DEFAULT_ANSWER = { pick: { instrumentSymbol: "GEMI-FED261211-MAINTAIN" }, confidence: 0.9, why: "Powell signals a hold." };

function setup(options: {
  readonly llm?: LlmCompleter | undefined;
  readonly provider?: LlmCompleter["provider"];
  readonly respond?: () => unknown;
  readonly markets?: ReturnType<typeof fakeMarkets>;
  readonly timeoutMs?: number;
} = {}) {
  const markets = options.markets ?? fakeMarkets();
  const respond = options.respond ?? (() => DEFAULT_ANSWER);
  const complete = vi.fn<LlmCompleter["complete"]>(() => Promise.resolve().then(respond));
  const llm = "llm" in options ? options.llm : { provider: options.provider ?? "grok", complete };
  const matcher = createPostMatcher({
    markets,
    llm,
    categories: ["Economics", "Politics", "Sports"],
    now: () => new Date("2026-11-17T12:00:00Z"),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return { matcher, complete, markets };
}

describe("post matcher", () => {
  it("returns the market Grok picked, with its reason", async () => {
    const { matcher } = setup();
    expect(await matcher.matchPost(FED_POST)).toMatchObject({
      kind: "matched",
      matchedBy: "grok",
      confidence: 0.9,
      why: "Powell signals a hold.",
      candidate: { eventTicker: "FED261211", category: "Economics", contract: { instrumentSymbol: "GEMI-FED261211-MAINTAIN" } },
    });
  });

  it("sends the prompt, candidates, schema, and timeout to the completer", async () => {
    const { matcher, complete } = setup({ timeoutMs: 1200 });
    await matcher.matchPost({ ...FED_POST, author: "@Reuters" });
    const request = complete.mock.calls[0]?.[0];
    const prompt = `${request?.system ?? ""}\n${request?.user ?? ""}`;
    expect(request).toMatchObject({
      schemaName: "post_market_pick",
      schema: { type: "object", additionalProperties: false },
      timeoutMs: 1200,
    });
    expect(prompt).toContain("GEMI-FED261211-MAINTAIN | Fed decision in December? | Fed maintains rate | 62c");
    expect(prompt).toContain("GEMI-PRES2028-VANCE");
    expect(prompt).toContain("by @Reuters");
    expect(prompt).not.toContain("GEMI-BTC15M");
    expect(prompt).not.toContain("GEMI-NBA-X");
  });

  it("includes sports markets only when the post shares title tokens", async () => {
    const { matcher, complete } = setup();
    await matcher.matchPost({ id: "2", text: "Chiefs beat the Bills 27-24 in a Sunday night thriller at Arrowhead" });
    const prompt = complete.mock.calls[0]?.[0].user ?? "";
    expect(prompt).toContain("GEMI-NFL-KC");
    expect(prompt).not.toContain("GEMI-NBA-X");
  });

  it("returns a Claude match", async () => {
    const { matcher } = setup({ provider: "claude" });
    expect(await matcher.matchPost(FED_POST)).toMatchObject({
      kind: "matched",
      matchedBy: "claude",
      candidate: { eventTicker: "FED261211", contract: { instrumentSymbol: "GEMI-FED261211-MAINTAIN" } },
    });
  });

  it("uses Claude's no-live-market reason for a null pick", async () => {
    const { matcher } = setup({ provider: "claude", respond: () => ({ pick: null, confidence: 0.1, why: "n/a" }) });
    expect(await matcher.matchPost(FED_POST)).toMatchObject({
      kind: "no-match",
      matchedBy: "claude",
      reason: "Claude found no live market this post moves.",
    });
  });

  it("rejects a pick that is not a supplied candidate", async () => {
    const { matcher } = setup({ respond: () => ({ pick: { instrumentSymbol: "GEMI-MADE-UP" }, confidence: 0.99, why: "x" }) });
    expect(await matcher.matchPost(FED_POST)).toMatchObject({
      kind: "no-match",
      matchedBy: "grok",
      reason: "Grok found no live market this post moves.",
    });
  });

  it("treats a null pick as no match without falling back", async () => {
    const { matcher, markets } = setup({ respond: () => ({ pick: null, confidence: 0.1, why: "n/a" }) });
    expect(await matcher.matchPost(FED_POST)).toMatchObject({ kind: "no-match", matchedBy: "grok" });
    expect(markets.searchEvents.mock.calls.every(([query]) => query?.category !== undefined)).toBe(true);
  });

  it("treats low confidence as no match", async () => {
    const { matcher } = setup({ respond: () => ({ pick: { instrumentSymbol: "GEMI-FED261211-MAINTAIN" }, confidence: 0.59, why: "x" }) });
    expect(await matcher.matchPost(FED_POST)).toMatchObject({
      kind: "no-match",
      matchedBy: "grok",
      reason: "Grok was not confident enough in a market for this post.",
    });
  });

  it("trims an over-long reason to 110 characters", async () => {
    const { matcher } = setup({
      respond: () => ({ pick: { instrumentSymbol: "GEMI-FED261211-MAINTAIN" }, confidence: 0.8, why: `  ${"word ".repeat(60)}` }),
    });
    const result = await matcher.matchPost(FED_POST);
    expect(result.kind === "matched" && result.why.length).toBeLessThanOrEqual(110);
    expect(trimWhy("a".repeat(200))).toHaveLength(110);
  });

  it.each([
    ["malformed content", () => "not json"],
    ["wrong shape", () => ({ pick: null })],
    ["confidence out of range", () => ({ pick: null, confidence: 4, why: "x" })],
    ["undefined completion", () => undefined],
    ["completion failure", () => Promise.reject(new TypeError("offline"))],
  ])("falls back to keywords on %s", async (_name, respond) => {
    const { matcher } = setup({ respond });
    expect(await matcher.matchPost(FED_POST)).toMatchObject({
      kind: "matched",
      matchedBy: "keywords",
      candidate: { eventTicker: "FED261211" },
    });
  });

  it("uses keywords without calling the completer when no provider is configured", async () => {
    const { matcher, complete } = setup({ llm: undefined });
    const result = await matcher.matchPost(FED_POST);
    expect(complete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "matched", matchedBy: "keywords" });
    expect(result.kind === "matched" && result.why).toMatch(/Fed/u);
  });

  it("matches a sports post from the nickname's city and skips unpriced contracts", async () => {
    const unpriced = event("NFL-2611221800-KC-BUF-S", "Kansas City vs Buffalo: Point Spread", "Sports", [{ ...contract("GEMI-KC2", "Kansas City"), prices: { bestBidCents: null, bestAskCents: null, lastTradeCents: null, buyYesCents: null, buyNoCents: 5, sellYesCents: null, sellNoCents: null } }]);
    const { matcher } = setup({ llm: undefined, markets: fakeMarkets([unpriced, intraday, sports]) });
    const result = await matcher.matchPost({ id: "5", text: "Chiefs host the Bills on Sunday, Chiefs favored" });
    expect(result).toMatchObject({ kind: "matched", matchedBy: "keywords", candidate: { eventTicker: "NFL-2611221800-KC-BUF-M", contract: { label: "Kansas City" } } });
  });

  it("reports no match from keywords for unrelated posts", async () => {
    const { matcher } = setup({ llm: undefined });
    expect(await matcher.matchPost({ id: "3", text: "Just had the best sandwich of my entire life today" })).toMatchObject({
      kind: "no-match",
      matchedBy: "keywords",
    });
  });

  it("caches the candidate universe for a minute", async () => {
    const { matcher, markets } = setup();
    await matcher.matchPost(FED_POST);
    const first = markets.searchEvents.mock.calls.filter(([query]) => query?.search === undefined).length;
    await matcher.matchPost({ ...FED_POST, id: "other" });
    expect(markets.searchEvents.mock.calls.filter(([query]) => query?.search === undefined)).toHaveLength(first);
  });

  it("bounds the prompt to the event and contract caps", async () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      event(`E${String(index)}`, `Topic ${String(index)}`, "Politics", Array.from({ length: 12 }, (_c, c) => contract(`S-${String(index)}-${String(c)}`, `Label ${String(c)}`))),
    );
    const { matcher, complete } = setup({ markets: fakeMarkets(many) });
    await matcher.matchPost({ id: "4", text: "A long discussion of politics and many unrelated topics today" });
    const prompt = complete.mock.calls[0]?.[0].user ?? "";
    const symbols = new Set(prompt.match(/S-\d+-\d+/gu));
    const events = new Set([...symbols].map((symbol) => symbol.split("-")[1]));
    expect(events.size).toBeLessThanOrEqual(MAX_EVENTS);
    expect(symbols.size).toBeLessThanOrEqual(MAX_EVENTS * MAX_CONTRACTS_PER_EVENT);
  });
});

describe("loadGrokSettings", () => {
  it("defaults the model and treats blank key as absent", () => {
    expect(loadGrokSettings({ XAI_API_KEY: " ", XAI_MODEL: "" })).toEqual({ apiKey: undefined, model: "grok-4.20-0309-non-reasoning" });
    expect(loadGrokSettings({ XAI_API_KEY: "k", XAI_MODEL: "m" })).toEqual({ apiKey: "k", model: "m" });
  });
});
