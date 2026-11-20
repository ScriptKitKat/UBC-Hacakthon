import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "@/features/history";
import { createPolicy } from "@/features/guardrails";
import { openSpendJournal } from "@/features/journal";
import type { UsdcLedger } from "@/features/ledger";
import { createUnconfiguredLedger } from "@/features/ledger";
import { createGeminiMarketsClient, fail, ok } from "@/features/markets";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { instrumentSymbol, usdCents } from "@/shared";
import type { LedgerView } from "@/shared";
import { createDesk } from "./desk";
import type { DeskDeps } from "./desk";
import type { StoredMatch } from "./match-store";
import { openFeedOrders } from "./feed-orders";
import { startReconciliation } from "./reconciliation";
import { openDecisionLog, openMigratedSpendJournal } from "./log-store";
import { createMemoryFileSystem } from "@/features/storage";

const symbol = instrumentSymbol("GEMI-FED261211-MAINTAIN");
const otherSymbol = instrumentSymbol("GEMI-FED261211-CUT25");

function contract(instrument: typeof symbol, label: string, marketState = "open"): MarketContract {
  return {
    instrumentSymbol: instrument,
    label,
    description: "",
    expiryDate: null,
    marketState,
    status: "active",
    prices: { bestBidCents: 60, bestAskCents: 62, lastTradeCents: 62, buyYesCents: 62, buyNoCents: 40, sellYesCents: 60, sellNoCents: 38 },
    limits: { quantityIncrementHundredths: 1n, quantityMinimumHundredths: 1n, priceIncrementCents: 1n, priceMinimumCents: 1n },
  };
}

function event(marketState = "open"): MarketEvent {
  return {
    ticker: "FED261211",
    slug: "fed-decision-in-december",
    title: "Fed decision in December?",
    category: "Economics",
    status: "active",
    expiryDate: null,
    description: "",
    subcategory: null,
    volume: null,
    volume24h: null,
    tags: ["fed"],
    contracts: [contract(symbol, "Fed maintains rate", marketState), contract(otherSymbol, "Cut 25bps")],
  };
}

function fakeMarkets(current: () => MarketEvent = event) {
  return {
    searchEvents: vi.fn<GeminiMarketsClient["searchEvents"]>(() => Promise.resolve(ok({ events: [current()], total: 1 }))),
    getEvent: vi.fn<GeminiMarketsClient["getEvent"]>(() => Promise.resolve(ok(current()))),
  };
}

const receipt = (signature: string) => ({ signature, explorerUrl: `https://explorer.test/tx/${signature}` });
const configuredLedger: LedgerView = {
  configured: true, cluster: "localnet", authority: "Authority1", mint: "Mint1", recipient: "Recipient1",
};

function setup(options: { ledger?: UsdcLedger; ledgerView?: LedgerView; markets?: ReturnType<typeof fakeMarkets>; killSwitch?: boolean; extra?: Partial<DeskDeps> } = {}) {
  let counter = 0;
  const debit = vi.fn<UsdcLedger["debit"]>(() => Promise.resolve({ ok: true, value: receipt(`sig-${String(++counter)}`) }));
  const ledger = options.ledger ?? { debit, signPayment: vi.fn(), checkSignature: vi.fn(), balance: vi.fn() };
  const markets = options.markets ?? fakeMarkets();
  const policy = createPolicy({
    dailyCap: usdCents(2000), autoApproveMax: usdCents(200), perTradeMax: usdCents(1000),
    marketAllowlist: new Set([symbol, otherSymbol]), marketCategories: new Set(["Economics"]), senderAllowlist: new Set(["priscilla"]), killSwitch: options.killSwitch ?? false,
  });
  if (!policy.ok) throw new Error("invalid policy");
  let ids = 0;
  let tick = 0;
  const desk = createDesk({
    policy: policy.value, feed: { operatorId: "priscilla", grok: { apiKey: undefined, model: "grok-test" } }, markets, ledger, ledgerView: options.ledgerView ?? configuredLedger,
    now: () => new Date(Date.parse("2026-11-17T12:00:00Z") + 30_000 * tick++), idGen: () => `id-${String(++ids)}`,
    ...options.extra,
  });
  return { desk, debit, markets };
}

const news = { id: "n1", text: "Fed officials signal they could hold rates steady at the December FOMC meeting, Powell says", url: "https://www.reuters.com/x", author: "Reuters", postedAt: new Date("2026-11-17T11:59:00Z") };
const propose = (outcome: "yes" | "no" = "yes", notionalCents = 200, senderId = "priscilla") =>
  ({ instrumentSymbol: symbol, outcome, notionalCents, source: "desk", senderId }) as const;

async function readyDesk(options: Parameters<typeof setup>[0] = {}) {
  const fixture = setup(options);
  await fixture.desk.submitNews(news);
  return fixture;
}

describe("desk", () => {
  it("stores matched news with live odds in the snapshot", async () => {
    const { desk } = await readyDesk();
    const snapshot = await desk.getSnapshot();
    expect(snapshot.news).toMatchObject({ sourceDomain: "reuters.com", author: "Reuters" });
    expect(snapshot.match).toMatchObject({
      kind: "matched",
      market: { instrumentSymbol: symbol, yesCents: 62, noCents: 40, marketState: "open", eventTitle: "Fed decision in December?" },
    });
    expect(snapshot.policy).toMatchObject({ dailyCapCents: 2000, spentCents: 0, remainingCents: 2000, killSwitch: false });
    expect(snapshot.ledger).toEqual(configuredLedger);
  });

  it("approve path debits the ledger then logs signature and paper ticket", async () => {
    const { desk, debit } = await readyDesk();
    const entry = await desk.proposeTrade(propose("yes", 200));
    expect(debit).toHaveBeenCalledOnce();
    expect(entry).toMatchObject({
      kind: "approve", signature: "sig-1", explorerUrl: "https://explorer.test/tx/sig-1", symbol, outcome: "yes", notionalCents: 200,
      ticket: { symbol, outcome: "yes", price: "0.62", quantity: "3.22", mode: "paper" },
    });
    const snapshot = await desk.getSnapshot();
    expect(snapshot.log[0]).toEqual(entry);
    expect(snapshot.policy).toMatchObject({ spentCents: 200, remainingCents: 1800 });
  });

  it("refuse path makes no ledger call", async () => {
    const { desk, debit } = await readyDesk();
    const stranger = await desk.proposeTrade(propose("yes", 200, "stranger"));
    const tooBig = await desk.proposeTrade(propose("yes", 5000));
    expect(stranger).toMatchObject({ kind: "refuse", code: "unauthorized-sender" });
    expect(tooBig).toMatchObject({ kind: "refuse", code: "over-per-trade-cap" });
    expect(debit).not.toHaveBeenCalled();
    expect((await desk.getSnapshot()).log.map((entry) => entry.kind)).toEqual(["refuse", "refuse"]);
  });

  it("trades a listed contract that no news was matched to", async () => {
    const { desk, debit, markets } = setup();
    const entry = await desk.proposeTrade(propose());
    expect(entry).toMatchObject({ kind: "approve", symbol });
    expect(markets.getEvent).toHaveBeenCalledWith("FED261211", { refresh: true });
    expect(debit).toHaveBeenCalledTimes(1);
  });

  it("refuses a contract its event does not list", async () => {
    const { desk, debit } = setup();
    const entry = await desk.proposeTrade({ ...propose(), instrumentSymbol: "GEMI-FED261211-DELISTED" });
    expect(entry).toMatchObject({ kind: "refuse", code: "market-closed" });
    expect(debit).not.toHaveBeenCalled();
  });

  it("refuses a contract that was never seen without calling the ledger", async () => {
    const { desk, debit } = await readyDesk();
    const entry = await desk.proposeTrade({ ...propose(), instrumentSymbol: "GEMI-UNKNOWN" });
    expect(entry).toMatchObject({ kind: "refuse", code: "market-closed" });
    expect(debit).not.toHaveBeenCalled();
  });

  it("refuses when the market closes or cannot be fetched", async () => {
    const markets = fakeMarkets(() => event("closed"));
    const { desk, debit } = await readyDesk({ markets });
    expect(await desk.proposeTrade(propose())).toMatchObject({ kind: "refuse", code: "market-closed" });
    markets.getEvent.mockResolvedValue(fail({ kind: "http", status: 500 }));
    expect(await desk.proposeTrade(propose())).toMatchObject({ kind: "refuse", code: "market-closed" });
    expect(debit).not.toHaveBeenCalled();
  });

  it.each([
    ["inactive event", { ...event(), status: "inactive" }],
    ["inactive contract", { ...event(), contracts: [{ ...contract(symbol, "Maintain"), status: "inactive" }] }],
    ["mismatched symbol", { ...event(), contracts: [contract(otherSymbol, "Cut")] }],
  ])("refuses a quote for %s without calling the ledger", async (_, unavailable) => {
    const { desk, debit, markets } = await readyDesk();
    markets.getEvent.mockResolvedValue(ok(unavailable));
    expect(await desk.proposeTrade(propose())).toMatchObject({ kind: "refuse", code: "market-closed" });
    expect(debit).not.toHaveBeenCalled();
  });

  it("refreshes the quote on confirmation and refuses a market that closed", async () => {
    const { desk, debit, markets } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("yes", 500));
    markets.getEvent.mockResolvedValue(ok(event("closed")));
    expect(await desk.confirmPending(waiting.intentId, "priscilla")).toMatchObject({
      ok: true, entry: { kind: "refuse", code: "market-closed" },
    });
    expect(markets.getEvent).toHaveBeenLastCalledWith("FED261211", { refresh: true });
    expect(debit).not.toHaveBeenCalled();
  });

  it("refuses a live sub-cent quote without calling the ledger", async () => {
    const { desk, debit, markets } = await readyDesk();
    const client = createGeminiMarketsClient({
      baseUrl: "https://example.test",
      fetch: () => Promise.resolve(Response.json({
        ...event(),
        contracts: [{
          instrumentSymbol: symbol, label: "Maintain", status: "active", marketState: "open",
          prices: { buy: { yes: "0.625" } },
        }],
      })),
    });
    markets.getEvent.mockImplementation(client.getEvent);
    expect(await desk.proposeTrade(propose())).toMatchObject({ kind: "refuse", code: "market-closed" });
    expect(debit).not.toHaveBeenCalled();
  });

  it("holds a needs-approval trade as pending and executes it on confirm", async () => {
    const { desk, debit } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("no", 500));
    expect(waiting).toMatchObject({ kind: "needs-approval", spokenReason: "The $5 trade needs your approval." });
    expect(debit).not.toHaveBeenCalled();
    expect((await desk.getSnapshot()).pending).toMatchObject([{ intentId: waiting.intentId, outcome: "no", notionalCents: 500 }]);

    const confirmed = await desk.confirmPending(waiting.intentId, "priscilla");
    expect(confirmed).toMatchObject({ ok: true, entry: { kind: "approve", signature: "sig-1", ticket: { outcome: "no", price: "0.40" } } });
    expect(debit).toHaveBeenCalledOnce();
    const snapshot = await desk.getSnapshot();
    expect(snapshot.pending).toEqual([]);
    expect(snapshot.policy.spentCents).toBe(500);
  });

  it("refuses to confirm twice and for unknown intents", async () => {
    const { desk, debit } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("yes", 500));
    await desk.confirmPending(waiting.intentId, "priscilla");
    expect(await desk.confirmPending(waiting.intentId, "priscilla")).toEqual({ ok: false, error: "unknown-intent" });
    expect(await desk.confirmPending("nope", "priscilla")).toEqual({ ok: false, error: "unknown-intent" });
    expect(debit).toHaveBeenCalledOnce();
  });

  it("re-checks the daily cap on confirm after other spend", async () => {
    const { desk, debit } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("yes", 500));
    for (let index = 0; index < 8; index++) await desk.proposeTrade(propose("yes", 200));
    debit.mockClear();
    const confirmed = await desk.confirmPending(waiting.intentId, "priscilla");
    expect(confirmed).toMatchObject({ ok: true, entry: { kind: "refuse", code: "over-daily-cap" } });
    expect(debit).not.toHaveBeenCalled();
  });

  it("keeps a pending trade when an unauthorized approver tries to confirm it", async () => {
    const { desk, debit } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("yes", 500));
    expect(await desk.confirmPending(waiting.intentId, "stranger")).toMatchObject({ ok: true, entry: { code: "unauthorized-sender" } });
    expect((await desk.getSnapshot()).pending).toHaveLength(1);
    expect(debit).not.toHaveBeenCalled();
  });

  it("rejects an in-memory pending trade and records the refusal", async () => {
    const { desk } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("no", 500));
    const rejected = await desk.rejectPending(waiting.intentId, "priscilla");
    expect(rejected).toMatchObject({
      ok: true,
      entry: { kind: "refuse", code: "rejected", spokenReason: "You rejected this trade." },
    });
    expect((await desk.getSnapshot()).pending).toEqual([]);
    expect((await desk.getSnapshot()).log[0]).toMatchObject({ kind: "refuse", code: "rejected" });
  });

  it("rejects unknown intents", async () => {
    const { desk } = await readyDesk();
    expect(await desk.rejectPending("unknown", "priscilla")).toEqual({ ok: false, error: "unknown-intent" });
  });

  it("keeps a pending trade when an unauthorized approver tries to reject it", async () => {
    const { desk } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("yes", 500));
    expect(await desk.rejectPending(waiting.intentId, "stranger")).toEqual({ ok: false, error: "unauthorized-approver" });
    expect((await desk.getSnapshot()).pending).toHaveLength(1);
  });

  it("cannot confirm a trade after rejecting it", async () => {
    const { desk } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("yes", 500));
    await desk.rejectPending(waiting.intentId, "priscilla");
    expect(await desk.confirmPending(waiting.intentId, "priscilla")).toEqual({ ok: false, error: "unknown-intent" });
  });

  it("kill switch blocks proposals and confirmations", async () => {
    const { desk, debit } = await readyDesk();
    const waiting = await desk.proposeTrade(propose("yes", 500));
    desk.setKillSwitch(true);
    expect((await desk.getSnapshot()).policy.killSwitch).toBe(true);
    expect(await desk.proposeTrade(propose("yes", 100))).toMatchObject({ kind: "refuse", code: "kill-switch" });
    expect(await desk.confirmPending(waiting.intentId, "priscilla")).toMatchObject({ ok: true, entry: { kind: "refuse", code: "kill-switch" } });
    expect(debit).not.toHaveBeenCalled();
    desk.setKillSwitch(false);
    expect(await desk.proposeTrade(propose("yes", 100))).toMatchObject({ kind: "approve" });
  });

  it("surfaces an unconfigured ledger as an explicit failure without spending budget", async () => {
    const { desk } = await readyDesk({
      ledger: createUnconfiguredLedger(), ledgerView: { configured: false, missing: ["USDC_MINT"] },
    });
    const entry = await desk.proposeTrade(propose("yes", 200));
    expect(entry).toMatchObject({ kind: "execution-failed", code: "ledger-not-configured" });
    expect(entry).not.toHaveProperty("signature");
    expect(entry).not.toHaveProperty("ticket");
    const snapshot = await desk.getSnapshot();
    expect(snapshot.ledger).toEqual({ configured: false, missing: ["USDC_MINT"] });
    expect(snapshot.policy.spentCents).toBe(0);
    expect(snapshot.policy.remainingCents).toBe(2000);
  });

  it("releases the reservation on a rejected debit but holds it when unconfirmed", async () => {
    const debit = vi.fn<UsdcLedger["debit"]>()
      .mockResolvedValueOnce({ ok: false, error: { code: "debit-rejected" } })
      .mockResolvedValueOnce({ ok: false, error: { code: "debit-unconfirmed", signature: "s" } });
    const { desk } = await readyDesk({ ledger: { debit, signPayment: vi.fn(), checkSignature: vi.fn(), balance: vi.fn() } });
    expect(await desk.proposeTrade(propose("yes", 200))).toMatchObject({ kind: "execution-failed", code: "debit-rejected" });
    expect((await desk.getSnapshot()).policy.remainingCents).toBe(2000);
    expect(await desk.proposeTrade(propose("yes", 200))).toMatchObject({ kind: "execution-failed", code: "debit-unconfirmed" });
    expect((await desk.getSnapshot()).policy.remainingCents).toBe(1800);
  });

  it("returns no-match for news without a market and an empty snapshot before any news", async () => {
    const markets = fakeMarkets();
    markets.searchEvents.mockResolvedValue(ok({ events: [], total: 0 }));
    const { desk } = setup({ markets });
    expect((await desk.getSnapshot()).match).toEqual({ kind: "no-news" });
    expect(await desk.submitNews(news)).toMatchObject({ kind: "no-match" });
  });

describe("desk feed", () => {
  const post = { id: "post-1", text: news.text, author: "@Reuters" };
  const sportsEvent: MarketEvent = {
    ticker: "NFL-2611221800-KC-BUF-M", title: "Kansas City vs Buffalo", category: "Sports", status: "active", expiryDate: null, description: "", subcategory: null, volume: null, volume24h: null, tags: [],
    contracts: [contract(instrumentSymbol("GEMI-NFL-KC"), "Kansas City")],
  };

  it("matches a post by keywords without a Grok key and registers the market for trading", async () => {
    const { desk } = setup();
    const match = await desk.matchPost(post);
    expect(match).toMatchObject({
      kind: "matched", postId: "post-1", matchedBy: "keywords",
      market: { eventTicker: "FED261211", category: "Economics", yesCents: 62, noCents: 40, impliedYesPercent: 62, tradeable: true },
    });
    const entry = await desk.buyFromFeed({ clientOrderId: "order-1", instrumentSymbol: match.kind === "matched" ? match.market.instrumentSymbol : "", outcome: "yes", notionalCents: 100 });
    expect(entry).toMatchObject({ kind: "approve", source: "feed", senderId: "priscilla" });
  });

  it("executes a repeated clientOrderId once and returns the recorded entry", async () => {
    const { desk, debit } = setup();
    await desk.matchPost(post);
    const order = { clientOrderId: "order-dup", instrumentSymbol: "GEMI-FED261211-MAINTAIN", outcome: "yes", notionalCents: 100 } as const;
    const [first, concurrent] = await Promise.all([desk.buyFromFeed(order), desk.buyFromFeed(order)]);
    const later = await desk.buyFromFeed(order);
    expect(concurrent).toBe(first);
    expect(later).toBe(first);
    expect(debit).toHaveBeenCalledTimes(1);
    await desk.buyFromFeed({ ...order, clientOrderId: "order-other" });
    expect(debit).toHaveBeenCalledTimes(2);
  });

  it("refuses a feed buy when the live price is more than 2 cents worse than the price seen", async () => {
    const { desk, debit } = setup();
    await desk.matchPost(post);
    const order = { instrumentSymbol: "GEMI-FED261211-MAINTAIN", outcome: "yes", notionalCents: 100 } as const;
    const moved = await desk.buyFromFeed({ ...order, clientOrderId: "order-moved", seenPriceCents: 59 });
    expect(moved).toMatchObject({ kind: "refuse", code: "price-moved", spokenReason: "The price moved from 59¢ to 62¢ since you saw it, so I did not place the trade." });
    expect(debit).not.toHaveBeenCalled();
    expect(await desk.buyFromFeed({ ...order, clientOrderId: "order-ok", seenPriceCents: 60 })).toMatchObject({ kind: "approve" });
  });

  it("authorizes only the matched event's listed contracts for the card", async () => {
    const { desk } = setup();
    expect(await desk.isCardFor("post-1", "GEMI-FED261211-MAINTAIN")).toBe(false);
    await desk.matchPost(post);
    expect(await desk.isCardFor("post-1", "GEMI-FED261211-MAINTAIN")).toBe(true);
    expect(await desk.isCardFor("post-1", "GEMI-FED261211-CUT25")).toBe(true);
    expect(await desk.isCardFor("post-1", "GEMI-FED261211-UNLISTED")).toBe(false);
    expect(await desk.isCardFor("other-post", "GEMI-FED261211-MAINTAIN")).toBe(false);
  });

  it("exposes Gemini links, rules, limits and selectable sibling contracts", async () => {
    const { desk } = setup();
    const match = await desk.matchPost(post);
    expect(match).toMatchObject({ kind: "matched", market: {
      geminiUrl: "https://www.gemini.com/predictions/FED261211/fed-decision-in-december?status=active",
      quantityLimits: { quantityIncrementHundredths: 1, quantityMinimumHundredths: 1 },
    }, contracts: [{ instrumentSymbol: symbol }, { instrumentSymbol: otherSymbol }] });
    expect(await desk.quote(otherSymbol)).toMatchObject({ market: { instrumentSymbol: otherSymbol, contractLabel: "Cut 25bps" }, contracts: [{ instrumentSymbol: symbol }, { instrumentSymbol: otherSymbol }] });
    expect(await desk.postContextFor(otherSymbol)).toMatchObject({ source: "x-feed", text: post.text });
    expect(await desk.buyFromFeed({ clientOrderId: "sibling-order", instrumentSymbol: otherSymbol, outcome: "yes", notionalCents: 100 })).toMatchObject({ kind: "approve", symbol: otherSymbol });
  });

  it("authorizes recovered sibling contracts and retains their post context", async () => {
    const markets = fakeMarkets();
    markets.getEvent.mockResolvedValueOnce(fail({ kind: "http", status: 500 }));
    const { desk } = setup({ markets, extra: { now: () => new Date("2026-11-17T12:00:00Z") } });
    const match = await desk.matchPost(post);
    expect(match).toMatchObject({ kind: "matched", contracts: [{ instrumentSymbol: symbol }] });
    expect(await desk.isCardFor(post.id, symbol)).toBe(true);
    expect(await desk.isCardFor(post.id, otherSymbol)).toBe(false);
    expect(await desk.postContextFor(otherSymbol)).toBeUndefined();

    expect(await desk.quote(symbol)).toMatchObject({ contracts: [{ instrumentSymbol: symbol }, { instrumentSymbol: otherSymbol }] });
    expect(await desk.isCardFor(post.id, otherSymbol)).toBe(true);
    expect(await desk.postContextFor(otherSymbol)).toMatchObject({ source: "x-feed", text: post.text });
    expect(await desk.isCardFor(post.id, "GEMI-FED261211-UNLISTED")).toBe(false);
    expect(await desk.isCardFor("other-post", otherSymbol)).toBe(false);
    expect(await desk.buyFromFeed({ clientOrderId: "recovered-sibling", instrumentSymbol: otherSymbol, outcome: "yes", notionalCents: 100 })).toMatchObject({ kind: "approve", symbol: otherSymbol });
  });

  it("caches matches per post id", async () => {
    const { desk, markets } = setup();
    await desk.matchPost(post);
    const calls = markets.searchEvents.mock.calls.length;
    await desk.matchPost(post);
    expect(markets.searchEvents.mock.calls).toHaveLength(calls);
  });

  it("serves posts matched ahead of time from the cache without matching again", async () => {
    const { desk, markets } = setup();
    const posts = [post, { id: "post-2", text: "Powell says the Fed will hold rates" }];
    const warmed = await Promise.all(posts.map((warm) => desk.matchPost(warm)));
    const calls = markets.searchEvents.mock.calls.length;
    const served = await Promise.all(posts.map((later) => desk.matchPost(later)));
    expect(served).toEqual(warmed);
    expect(markets.searchEvents.mock.calls).toHaveLength(calls);
  });

  it("reports no-match for unrelated posts", async () => {
    const { desk } = setup();
    expect(await desk.matchPost({ id: "p2", text: "Just had the best sandwich of my life today" })).toMatchObject({ kind: "no-match", postId: "p2" });
  });

  it("searches sports games for cards even when the trading policy excludes Sports", async () => {
    const markets = fakeMarkets(() => sportsEvent);
    markets.searchEvents.mockImplementation((query) =>
      Promise.resolve(ok(query?.category === "Sports" && query.search ? { events: [sportsEvent], total: 1 } : { events: [], total: 0 })));
    const { desk } = setup({ markets });
    const match = await desk.matchPost({ id: "p4", text: "Chiefs vs Bills tonight: Chiefs favored by three points" });
    expect(match).toMatchObject({ kind: "matched", market: { eventTicker: "NFL-2611221800-KC-BUF-M", tradeable: false } });
  });

  it("shows sports cards as not tradeable and refuses the buy with the policy reason", async () => {
    const markets = fakeMarkets(() => sportsEvent);
    const { desk, debit } = setup({ markets });
    const match = await desk.matchPost({ id: "p3", text: "Chiefs vs Bills tonight: Chiefs favored by three points" });
    expect(match).toMatchObject({
      kind: "matched",
      market: { category: "Sports", tradeable: false, tradeBlockedReason: "Sports markets are outside the desk's news-trading policy." },
    });
    const entry = await desk.buyFromFeed({ clientOrderId: "order-2", instrumentSymbol: "GEMI-NFL-KC", outcome: "yes", notionalCents: 100 });
    expect(entry).toMatchObject({
      kind: "refuse", code: "market-category-not-allowed", spokenReason: "Sports markets are outside the desk's news-trading policy.",
    });
    expect(debit).not.toHaveBeenCalled();
  });

  it("records observed yes prices and serves quote with history", async () => {
    const { desk } = setup();
    await desk.matchPost(post);
    const quote = await desk.quote("GEMI-FED261211-MAINTAIN");
    expect(quote?.market.yesCents).toBe(62);
    expect(quote?.history.length).toBeGreaterThanOrEqual(2);
    expect(quote?.history[0]).toMatchObject({ yesCents: 62 });
    expect(await desk.quote("GEMI-UNSEEN")).toBeUndefined();
  });

  it("holds feed buys above the auto-approve limit for approval and confirms only feed intents as the operator", async () => {
    const { desk, debit } = setup();
    await desk.matchPost(post);
    const waiting = await desk.buyFromFeed({ clientOrderId: "order-3", instrumentSymbol: "GEMI-FED261211-MAINTAIN", outcome: "no", notionalCents: 500 });
    expect(waiting).toMatchObject({ kind: "needs-approval", source: "feed" });
    expect(debit).not.toHaveBeenCalled();
    const confirmed = await desk.confirmFromFeed(waiting.intentId);
    expect(confirmed).toMatchObject({ ok: true, entry: { kind: "approve", source: "feed" } });
    expect(await desk.confirmFromFeed(waiting.intentId)).toEqual(confirmed);
  });

  it("rejects a feed order that needs approval and removes it from pending", async () => {
    const { desk } = setup();
    await desk.matchPost(post);
    const waiting = await desk.buyFromFeed({
      clientOrderId: "reject-order",
      instrumentSymbol: "GEMI-FED261211-MAINTAIN",
      outcome: "no",
      notionalCents: 500,
    });
    expect(waiting.kind).toBe("needs-approval");
    const rejected = await desk.rejectPending(waiting.intentId, "priscilla");
    expect(rejected).toMatchObject({
      ok: true,
      entry: { kind: "refuse", code: "rejected", source: "feed" },
    });
    expect(await desk.feedOrder("reject-order")).toMatchObject({ kind: "refuse", code: "rejected" });
    expect((await desk.getSnapshot()).pending).toEqual([]);
  });

  it("does not change a feed order that no longer needs approval", async () => {
    const { desk } = setup();
    await desk.matchPost(post);
    const completed = await desk.buyFromFeed({
      clientOrderId: "completed-order",
      instrumentSymbol: "GEMI-FED261211-MAINTAIN",
      outcome: "yes",
      notionalCents: 200,
    });
    const rejected = await desk.rejectPending(completed.intentId, "priscilla");
    expect(rejected).toEqual({ ok: true, entry: completed });
    expect(await desk.feedOrder("completed-order")).toEqual(completed);
  });

  it("does not let the feed confirm intents from other sources", async () => {
    const { desk } = await readyDesk();
    const other = await desk.proposeTrade({ ...propose("yes", 500), source: "x" });
    expect(other.kind).toBe("needs-approval");
    expect(await desk.confirmFromFeed(other.intentId)).toEqual({ ok: false, error: "unknown-intent" });
  });
});

});

describe("desk persistence, positions and research context", () => {
  it("restores the decision log, positions and the day's spend after a restart", async () => {
    const fs = createMemoryFileSystem();
    const first = await openDecisionLog({ fs, path: "/d/log.json" });
    const journal = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    const { desk } = await readyDesk({ extra: { initialLog: first.initialLog, saveLog: first.saveLog, journal } });
    const filled = await desk.proposeTrade(propose("yes", 200));
    expect(filled.kind).toBe("approve");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await openDecisionLog({ fs, path: "/d/log.json" });
    const reopened = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    const { desk: restarted } = setup({ extra: { initialLog: second.initialLog, saveLog: second.saveLog, journal: reopened } });
    const snapshot = await restarted.getSnapshot();
    expect(snapshot.log).toEqual([filled]);
    expect(snapshot.policy).toMatchObject({ spentCents: 200, remainingCents: 1800 });
    const positions = await restarted.getPositions();
    expect(positions.positions).toHaveLength(1);
    expect(positions.positions[0]).toMatchObject({ symbol, outcome: "yes", costCents: 200, status: "open" });
  });

  it("adopts legacy paid decisions once and restores spend and positions before trading", async () => {
    const fs = createMemoryFileSystem();
    const { desk } = await readyDesk();
    const filled = await desk.proposeTrade(propose("yes", 200));
    const logOptions = { fs, path: "/d/log.json" };
    const log = await openDecisionLog(logOptions);
    await log.saveLog([
      filled,
      { ...filled, entryId: "duplicate-intent", signature: "different-signature" },
      { ...filled, entryId: "duplicate-signature", intentId: "different-intent" },
      { ...filled, kind: "execution-failed", entryId: "failed", intentId: "failed", signature: "failed-signature" },
    ]);
    const { initialLog } = await openDecisionLog(logOptions);
    const options = { fs, path: "/d/journal.json", nowIso: () => filled.at };

    const migrated = await openMigratedSpendJournal(options, initialLog);
    const writesAfterMigration = fs.writes.length;
    const reopened = await openMigratedSpendJournal(options, initialLog);
    expect(fs.writes).toHaveLength(writesAfterMigration);
    expect(reopened.entries()).toEqual(migrated.entries());
    expect(reopened.entries()).toMatchObject([{ operationId: filled.intentId, status: "settled", signature: filled.signature, resolvedAt: filled.at }]);

    const { desk: restarted } = setup({ extra: { initialLog, journal: reopened } });
    expect((await restarted.getSnapshot()).policy).toMatchObject({ spentCents: 200, remainingCents: 1800 });
    expect((await restarted.getPositions()).positions).toHaveLength(1);
  });

  it("restores a paid approval when only its reservation reached the journal on disk", async () => {
    const fs = createMemoryFileSystem();
    const { desk } = await readyDesk();
    const filled = await desk.proposeTrade(propose("yes", 200));
    if (!filled.signature || !filled.ticket) throw new Error("Expected a paid trade");
    const options = { fs, path: "/d/journal.json", nowIso: () => filled.at };
    const journal = await openSpendJournal(options);
    expect(await journal.begin({
      operationId: filled.intentId,
      kind: "trade",
      notionalCents: filled.notionalCents,
      symbol: filled.symbol,
      outcome: filled.outcome,
      senderId: filled.senderId,
      source: filled.source,
      ticket: filled.ticket,
    })).toEqual({ ok: true });
    expect(await journal.attachPayment(filled.intentId, {
      signature: filled.signature,
      blockhash: "recorded-hash",
      lastValidBlockHeight: 123,
      explorerUrl: "https://explorer.test/tx/recorded",
    })).toEqual({ ok: true });

    await openMigratedSpendJournal(options, [filled]);
    const restarted = await openSpendJournal(options);
    expect(restarted.entries()).toMatchObject([{
      operationId: filled.intentId,
      status: "settled",
      signature: filled.signature,
      resolvedAt: filled.at,
      lastValidBlockHeight: 123,
    }]);
    const { desk: recovered } = setup({ extra: { initialLog: [filled], journal: restarted } });
    expect((await recovered.getSnapshot()).policy).toMatchObject({ spentCents: 200, remainingCents: 1800 });
    expect((await recovered.getPositions()).positions).toHaveLength(1);
  });

  it("refuses to start empty when the decision log is corrupt", async () => {
    const fs = createMemoryFileSystem({ "/d/log.json": "}{" });
    await expect(openDecisionLog({ fs, path: "/d/log.json" })).rejects.toMatchObject({ name: "StoreUnavailableError" });
    expect([...fs.files.keys()].some((name) => name.startsWith("/d/log.json.corrupt-"))).toBe(true);
  });

  it("keeps every filled position even after the display log has rolled over", async () => {
    const { desk } = await readyDesk();
    await desk.proposeTrade(propose("yes", 200));
    for (let index = 0; index < 1100; index += 1) await desk.proposeTrade(propose("yes", 200, "stranger"));
    const snapshot = await desk.getSnapshot();
    expect(snapshot.log.some((entry) => entry.kind === "approve")).toBe(false);
    const { positions } = await desk.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ costCents: 200 });
  });

  it("does not let a restart reopen a cap that was already spent", async () => {
    const fs = createMemoryFileSystem();
    const journal = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    const { desk } = await readyDesk({ extra: { journal } });
    for (let index = 0; index < 10; index += 1) await desk.proposeTrade(propose("yes", 200));
    expect((await desk.getSnapshot()).policy.remainingCents).toBe(0);
    const reopened = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    const { desk: restarted, debit } = await readyDesk({ extra: { journal: reopened, idGen: () => "after-restart" } });
    expect(await restarted.proposeTrade(propose("yes", 200))).toMatchObject({ kind: "refuse", code: "over-daily-cap" });
    expect(debit).not.toHaveBeenCalled();
  });

  it("writes the reservation, then the signature, to disk before the debit can be broadcast, and settles it afterwards", async () => {
    const fs = createMemoryFileSystem();
    const journal = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    let onDiskAtBroadcast: unknown;
    const debit = vi.fn<UsdcLedger["debit"]>(async (_intent, _notional, _memo, beforeBroadcast) => {
      await beforeBroadcast({ signature: "sig-9", blockhash: "hash-9", lastValidBlockHeight: 123, explorerUrl: "https://explorer.test/tx/sig-9" });
      onDiskAtBroadcast = JSON.parse(fs.files.get("/d/journal.json") ?? "{}");
      return { ok: true, value: receipt("sig-9") };
    });
    const { desk } = await readyDesk({ ledger: { debit, signPayment: vi.fn(), checkSignature: vi.fn(), balance: vi.fn() }, extra: { journal } });
    await desk.proposeTrade(propose("yes", 200));
    expect(onDiskAtBroadcast).toMatchObject({ entries: [{ kind: "trade", status: "reserved", signature: "sig-9", blockhash: "hash-9", lastValidBlockHeight: 123, ticket: { quantity: expect.any(String) as unknown } }] });
    expect(journal.entries()).toMatchObject([{ status: "settled", signature: "sig-9" }]);
  });

  it("refuses to trade, and never debits, when the reservation cannot be written", async () => {
    const memory = createMemoryFileSystem();
    const fs = { ...memory, writeTextAtomic: () => Promise.reject(new Error("ENOSPC")) };
    const journal = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    const { desk, debit } = await readyDesk({ extra: { journal } });
    expect(await desk.proposeTrade(propose("yes", 200))).toMatchObject({
      kind: "execution-failed", code: "journal-unavailable", spokenReason: "I couldn't record the payment safely, so I did not place the trade.",
    });
    expect(debit).not.toHaveBeenCalled();
    expect((await desk.getSnapshot()).policy.remainingCents).toBe(2000);
  });

  it("keeps an unconfirmed debit reserved across a restart and turns it into a position once the chain shows it landed", async () => {
    const fs = createMemoryFileSystem();
    const journal = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    const debit = vi.fn<UsdcLedger["debit"]>(async (_intent, _notional, _memo, beforeBroadcast) => {
      await beforeBroadcast({ signature: "sig-u", blockhash: "hash-u", lastValidBlockHeight: 123, explorerUrl: "https://explorer.test/tx/sig-u" });
      return { ok: false, error: { code: "debit-unconfirmed", signature: "sig-u" } };
    });
    const { desk } = await readyDesk({ ledger: { debit, signPayment: vi.fn(), checkSignature: vi.fn(), balance: vi.fn() }, extra: { journal } });
    await desk.proposeTrade(propose("yes", 200));
    const reopened = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    const checkSignature = vi.fn<UsdcLedger["checkSignature"]>(() => Promise.resolve("pending"));
    const ledger = { debit: vi.fn(), signPayment: vi.fn(), checkSignature, balance: vi.fn() };
    const { desk: restarted } = await readyDesk({ ledger, extra: { journal: reopened } });
    expect((await restarted.getSnapshot()).policy.remainingCents).toBe(1800);
    expect((await restarted.getPositions()).positions).toEqual([]);
    checkSignature.mockResolvedValue("landed");
    expect(await restarted.reconcile()).toEqual({ settled: 1, failed: 0, stillReserved: 0 });
    expect(checkSignature).toHaveBeenCalledWith({ signature: "sig-u", lastValidBlockHeight: 123 });
    const view = await restarted.getPositions();
    expect(view.positions).toHaveLength(1);
    expect(view.positions[0]).toMatchObject({ symbol, outcome: "yes", costCents: 200 });
    expect((await restarted.getSnapshot()).policy).toMatchObject({ spentCents: 200, remainingCents: 1800 });
  });

  it("releases a trade whose payment was never signed once it is reconciled", async () => {
    const fs = createMemoryFileSystem();
    const journal = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T12:00:00.000Z" });
    await journal.begin({ operationId: "crashed", kind: "trade", notionalCents: 200, symbol, outcome: "yes", senderId: "priscilla", source: "feed" });
    const { desk } = await readyDesk({ extra: { journal } });
    expect((await desk.getSnapshot()).policy.remainingCents).toBe(1800);
    expect(await desk.reconcile()).toEqual({ settled: 0, failed: 1, stillReserved: 0 });
    expect((await desk.getSnapshot()).policy.remainingCents).toBe(2000);
  });

  it("does not release a reservation that belongs to another operation when a trade fails across midnight", async () => {
    const fs = createMemoryFileSystem();
    const journal = await openSpendJournal({ fs, path: "/d/journal.json", nowIso: () => "2026-11-17T23:59:00.000Z" });
    await journal.begin({ operationId: "older", kind: "research", notionalCents: 5, symbol, outcome: null, senderId: "research-agent", source: "research" });
    await journal.attachPayment("older", { signature: "s", blockhash: "h", lastValidBlockHeight: 123, explorerUrl: "e" });
    const debit = vi.fn<UsdcLedger["debit"]>(() => Promise.resolve({ ok: false, error: { code: "debit-rejected" } }));
    const { desk } = await readyDesk({ ledger: { debit, signPayment: vi.fn(), checkSignature: vi.fn(), balance: vi.fn() }, extra: { journal } });
    await desk.proposeTrade(propose("yes", 200));
    expect((await desk.getSnapshot()).policy.remainingCents).toBe(1995);
  });

  it("values filled positions at the sell price once the market is known", async () => {
    const { desk } = await readyDesk();
    await desk.proposeTrade(propose("yes", 200));
    const { positions, totals } = await desk.getPositions();
    expect(positions[0]).toMatchObject({ eventTitle: "Fed decision in December?", status: "open", currentCents: 60, contracts: 3.22 });
    expect(totals.unpricedPositions).toBe(0);
    expect(await desk.getFeedPositions()).toEqual({
      positions: [{
        symbol, eventTitle: "Fed decision in December?", contractLabel: positions[0]?.contractLabel,
        outcome: "yes", contracts: 3.22, averageEntryCents: 62, currentCents: 60,
        pnlCents: positions[0]?.pnlCents, pnlPercent: positions[0]?.pnlPercent,
        explorerUrl: positions[0]?.fills.at(-1)?.explorerUrl, researchPath: `/markets/${symbol}`,
      }],
      totals,
      budget: { dailyCapCents: 2000, spentCents: 200, remainingCents: 1800, researchSpentCents: 0, perTradeMaxCents: 1000, autoApproveMaxCents: 200 },
    });
  });

  it("only counts filled entries as positions", async () => {
    const { desk } = setup();
    await desk.proposeTrade(propose("yes", 200, "stranger"));
    expect((await desk.getPositions()).positions).toEqual([]);
  });

  it("serves the x post that matched a market as research context", async () => {
    const { desk } = setup();
    const post = { id: "ctx-1", text: news.text, author: "@Reuters", url: "https://x.com/Reuters/status/1" };
    const match = await desk.matchPost(post);
    if (match.kind !== "matched") throw new Error("expected a match");
    expect(await desk.postContextFor(match.market.instrumentSymbol)).toMatchObject({
      source: "x-feed", text: news.text, author: "@Reuters", url: "https://x.com/Reuters/status/1", why: match.why,
    });
    const context = await desk.postContextFor(match.market.instrumentSymbol);
    expect(context?.atMs).toEqual(expect.any(Number));
    expect(await desk.postContextFor("GEMI-OTHER-X")).toBeUndefined();
  });

  it("persists matched X posts so research can reuse them after a restart", async () => {
    let stored: StoredMatch[] = [];
    const { desk } = setup({
      extra: {
        saveMatches: (matches) => {
          stored = [...matches];
          return Promise.resolve();
        },
      },
    });
    const post = { id: "2122556892543394292", text: news.text, author: "@Reuters", url: "https://x.com/Reuters/status/2122556892543394292" };
    const match = await desk.matchPost(post);
    if (match.kind !== "matched") throw new Error("expected a match");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.atMs).toBe(1_794_891_973_039);
    const reopened = setup({ extra: { initialMatches: stored } }).desk;
    expect(await reopened.matchedPostsFor(match.market.instrumentSymbol)).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "x-feed", text: news.text, author: "@Reuters", atMs: 1_794_891_973_039 }),
    ]));
  });

  it("falls back to the submitted news as research context", async () => {
    const { desk } = setup();
    const view = await desk.submitNews(news);
    if (view.kind !== "matched") throw new Error("expected a match");
    expect(await desk.postContextFor(view.market.instrumentSymbol)).toMatchObject({ source: "news", text: news.text, author: "Reuters" });
  });

  it("feeds quote history from the shared history store", async () => {
    const history = createMemoryHistory();
    const { desk } = setup({ extra: { history } });
    await desk.matchPost({ id: "h1", text: news.text });
    await desk.quote("GEMI-FED261211-MAINTAIN");
    expect(history.watched()).toContain("GEMI-FED261211-MAINTAIN");
    expect(history.series("GEMI-FED261211-MAINTAIN")).toHaveLength(2);
  });
});

describe("durable feed orders", () => {
  const now = () => new Date("2026-11-17T12:00:00Z");
  const order = { clientOrderId: "first", instrumentSymbol: symbol, outcome: "yes", notionalCents: 100 } as const;

  async function open(fs: ReturnType<typeof createMemoryFileSystem>, clock = now) {
    const journal = await openSpendJournal({ fs, path: "journal.json", nowIso: () => clock().toISOString() });
    const feedOrders = await openFeedOrders({ fs, path: "orders.json" });
    return { journal, feedOrders, now: clock };
  }

  it("returns the original result after more orders than the former cache could hold", async () => {
    const extra = await open(createMemoryFileSystem());
    const { desk, debit } = await readyDesk({ extra });
    const first = await desk.buyFromFeed(order);
    for (let index = 0; index < 501; index += 1) {
      await desk.buyFromFeed({ ...order, clientOrderId: `later-${String(index)}`, notionalCents: 1001 });
    }
    expect(await desk.buyFromFeed(order)).toEqual(first);
    expect(debit).toHaveBeenCalledOnce();
  });

  it("records a single order before the debit and returns it after reopening the stores", async () => {
    const fs = createMemoryFileSystem();
    const extra = await open(fs);
    const debit = vi.fn<UsdcLedger["debit"]>(async (intentId, _amount, _memo, beforeBroadcast) => {
      const reopened = await open(fs);
      expect(reopened.feedOrders.find(order.clientOrderId)?.entry).toMatchObject({ intentId, code: "order-in-progress" });
      await beforeBroadcast({ signature: "paid", blockhash: "hash", lastValidBlockHeight: 123, explorerUrl: receipt("paid").explorerUrl });
      return { ok: true, value: receipt("paid") };
    });
    const { desk } = await readyDesk({ extra, ledger: { ...createUnconfiguredLedger(), debit } });
    const [first, duplicate] = await Promise.all([desk.buyFromFeed(order), desk.buyFromFeed(order)]);
    expect(first).toMatchObject({ kind: "approve", signature: "paid" });
    expect(duplicate).toEqual(first);
    expect(debit).toHaveBeenCalledOnce();

    const restarted = setup({ extra: await open(fs) });
    expect(await restarted.desk.buyFromFeed(order)).toEqual(first);
    expect(restarted.debit).not.toHaveBeenCalled();
  });

  it("recovers a settled order when a write fails after the debit", async () => {
    const memory = createMemoryFileSystem();
    let denyOrderWrites = false;
    const fs = {
      ...memory,
      writeTextAtomic: (path: string, text: string) => {
        if (denyOrderWrites && path === "orders.json") return Promise.reject(new Error("ENOSPC"));
        return memory.writeTextAtomic(path, text);
      },
    };
    const debit = vi.fn<UsdcLedger["debit"]>(async (_id, _amount, _memo, beforeBroadcast) => {
      await beforeBroadcast({ signature: "paid", blockhash: "hash", lastValidBlockHeight: 123, explorerUrl: receipt("paid").explorerUrl });
      denyOrderWrites = true;
      return { ok: true, value: receipt("paid") };
    });
    const { desk } = await readyDesk({ extra: await open(fs), ledger: { ...createUnconfiguredLedger(), debit } });
    await expect(desk.buyFromFeed(order)).rejects.toThrow("ENOSPC");
    expect(debit).toHaveBeenCalledOnce();

    denyOrderWrites = false;
    const extra = await open(fs);
    const restarted = setup({ extra });
    const restored = await restarted.desk.buyFromFeed(order);
    expect(restored).toMatchObject({ kind: "approve", signature: "paid", ticket: { symbol } });
    expect(restarted.debit).not.toHaveBeenCalled();
    await restarted.desk.reconcile();
    expect((await open(fs)).feedOrders.find(order.clientOrderId)?.entry).toEqual(restored);
  });

  it("restores a pending approval and records one result across concurrent confirmations and another restart", async () => {
    const fs = createMemoryFileSystem();
    const { desk } = await readyDesk({ extra: await open(fs) });
    const waiting = await desk.buyFromFeed({ ...order, notionalCents: 500 });
    expect(waiting.kind).toBe("needs-approval");

    const restarted = setup({ extra: { ...await open(fs), idGen: () => "confirmed" } });
    expect(await restarted.desk.buyFromFeed(order)).toEqual(waiting);
    expect((await restarted.desk.getSnapshot()).pending).toMatchObject([{ intentId: waiting.intentId }]);
    const [first, duplicate] = await Promise.all([
      restarted.desk.confirmFromFeed(waiting.intentId),
      restarted.desk.confirmFromFeed(waiting.intentId),
    ]);
    expect(first).toMatchObject({ ok: true, entry: { kind: "approve" } });
    expect(duplicate).toEqual(first);
    expect(restarted.debit).toHaveBeenCalledOnce();

    const reopened = setup({ extra: await open(fs) });
    expect(await reopened.desk.confirmFromFeed(waiting.intentId)).toEqual(first);
    expect(reopened.debit).not.toHaveBeenCalled();
  });

  it("returns old completed orders after other writes and a restart", async () => {
    const fs = createMemoryFileSystem();
    const { desk, debit } = await readyDesk({ extra: await open(fs) });
    const settled = await desk.buyFromFeed(order);
    expect(settled.kind).toBe("approve");
    expect(debit).toHaveBeenCalledOnce();

    const later = () => new Date("2026-11-25T12:00:00Z");
    const reopened = await readyDesk({ extra: { ...await open(fs, later), idGen: () => "later" } });
    await reopened.desk.buyFromFeed({ ...order, clientOrderId: "other", notionalCents: 1001 });
    expect(await reopened.desk.buyFromFeed(order)).toEqual(settled);
    const restarted = await readyDesk({ extra: await open(fs, later) });
    expect(await restarted.desk.buyFromFeed(order)).toEqual(settled);
    expect(reopened.debit).not.toHaveBeenCalled();
    expect(restarted.debit).not.toHaveBeenCalled();
  });

  it("fails closed on order store corruption", async () => {
    const fs = createMemoryFileSystem();
    const options = { fs, path: "orders.json" };
    await fs.writeTextAtomic("orders.json", "{corrupt");
    const writes = fs.writes.length;
    await expect(openFeedOrders(options)).rejects.toMatchObject({ name: "StoreUnavailableError" });
    expect(fs.writes).toHaveLength(writes);
  });
});

describe("periodic payment reconciliation", () => {
  it("skips live trades, coalesces overlapping ticks, and settles or releases stuck trades in-session", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      const fs = createMemoryFileSystem();
      const now = () => new Date("2026-11-17T12:00:00Z");
      const journal = await openSpendJournal({ fs, path: "journal.json", nowIso: () => now().toISOString() });
      const expiry = { signature: "expired", blockhash: "hash", lastValidBlockHeight: 123, explorerUrl: "explorer" };
      await journal.begin({ operationId: "expired", kind: "trade", notionalCents: 100, symbol, outcome: "yes", senderId: "priscilla", source: "desk" });
      await journal.attachPayment("expired", expiry);

      const signed = Promise.withResolvers<undefined>();
      const stopped = Promise.withResolvers<undefined>();
      const scanned = Promise.withResolvers<"failed">();
      const debit = vi.fn<UsdcLedger["debit"]>(async (_id, _amount, _memo, beforeBroadcast) => {
        await beforeBroadcast({ ...expiry, signature: "stuck" });
        signed.resolve(undefined);
        await stopped.promise;
        return { ok: false, error: { code: "debit-unconfirmed", signature: "stuck" } };
      });
      const checkSignature = vi.fn<UsdcLedger["checkSignature"]>(({ signature }) =>
        signature === "expired" ? scanned.promise : Promise.resolve("landed"));
      const { desk } = await readyDesk({ extra: { journal, now }, ledger: { ...createUnconfiguredLedger(), debit, checkSignature } });
      const order = desk.buyFromFeed({ clientOrderId: "stuck-order", instrumentSymbol: symbol, outcome: "yes", notionalCents: 200 });
      await signed.promise;
      timer = startReconciliation(desk.reconcile);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(checkSignature).toHaveBeenCalledExactlyOnceWith({ signature: "expired", lastValidBlockHeight: 123 });

      scanned.resolve("failed");
      await desk.reconcile();
      expect(journal.find("expired")?.status).toBe("failed");
      expect((await desk.getPositions()).positions).toEqual([]);
      expect((await desk.getSnapshot()).policy).toMatchObject({ spentCents: 0, remainingCents: 1800 });
      expect(checkSignature).toHaveBeenCalledOnce();

      stopped.resolve(undefined);
      expect(await order).toMatchObject({ code: "debit-unconfirmed" });
      await vi.advanceTimersByTimeAsync(30_000);
      await desk.reconcile();
      expect(checkSignature).toHaveBeenCalledTimes(2);
      expect((await desk.getPositions()).positions).toMatchObject([{ symbol, costCents: 200 }]);
      expect((await desk.getSnapshot()).policy).toMatchObject({ spentCents: 200, remainingCents: 1800 });
      expect(await desk.feedOrder("stuck-order")).toMatchObject({ kind: "approve", signature: "stuck" });
      expect(debit).toHaveBeenCalledOnce();
    } finally {
      if (timer) clearInterval(timer);
      vi.useRealTimers();
    }
  });
});
