import { describe, expect, it, vi } from "vitest";
import { createPolicy } from "@/features/guardrails";
import type { UsdcLedger } from "@/features/ledger";
import { createUnconfiguredLedger } from "@/features/ledger";
import { createGeminiMarketsClient, fail, ok } from "@/features/markets";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { instrumentSymbol, usdCents } from "@/shared";
import type { LedgerView } from "@/shared";
import { createDesk } from "./desk";

const symbol = instrumentSymbol("GEMI-FED261211-MAINTAIN");
const otherSymbol = instrumentSymbol("GEMI-FED261211-CUT25");

function contract(instrument: typeof symbol, label: string, marketState = "open"): MarketContract {
  return {
    instrumentSymbol: instrument,
    label,
    marketState,
    status: "active",
    prices: { bestBidCents: 60, bestAskCents: 62, lastTradeCents: 62, buyYesCents: 62, buyNoCents: 40 },
    limits: { quantityIncrementHundredths: 1n, quantityMinimumHundredths: 1n, priceIncrementCents: 1n, priceMinimumCents: 1n },
  };
}

function event(marketState = "open"): MarketEvent {
  return {
    ticker: "FED261211",
    title: "Fed decision in December?",
    category: "Economics",
    status: "active",
    expiryDate: null,
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

function setup(options: { ledger?: UsdcLedger; ledgerView?: LedgerView; markets?: ReturnType<typeof fakeMarkets>; killSwitch?: boolean } = {}) {
  let counter = 0;
  const debit = vi.fn<UsdcLedger["debit"]>(() => Promise.resolve({ ok: true, value: receipt(`sig-${String(++counter)}`) }));
  const ledger = options.ledger ?? { debit, balance: vi.fn() };
  const markets = options.markets ?? fakeMarkets();
  const policy = createPolicy({
    dailyCap: usdCents(2000), autoApproveMax: usdCents(200), perTradeMax: usdCents(1000),
    marketAllowlist: new Set([symbol, otherSymbol]), marketCategories: new Set(["Economics"]), senderAllowlist: new Set(["priscilla"]), killSwitch: options.killSwitch ?? false,
  });
  if (!policy.ok) throw new Error("invalid policy");
  let ids = 0;
  const desk = createDesk({
    policy: policy.value, feed: { operatorId: "priscilla", grok: { apiKey: undefined, model: "grok-test" } }, markets, ledger, ledgerView: options.ledgerView ?? configuredLedger,
    now: () => new Date("2026-11-17T12:00:00Z"), idGen: () => `id-${String(++ids)}`,
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
    const { desk } = await readyDesk({ ledger: { debit, balance: vi.fn() } });
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
    ticker: "NFL-2611221800-KC-BUF-M", title: "Kansas City vs Buffalo", category: "Sports", status: "active", expiryDate: null, tags: [],
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

  it("only treats a cached match as the card for its own post and contract", async () => {
    const { desk } = setup();
    expect(await desk.isCardFor("post-1", "GEMI-FED261211-MAINTAIN")).toBe(false);
    await desk.matchPost(post);
    expect(await desk.isCardFor("post-1", "GEMI-FED261211-MAINTAIN")).toBe(true);
    expect(await desk.isCardFor("post-1", "GEMI-FED261211-CUT25")).toBe(false);
    expect(await desk.isCardFor("other-post", "GEMI-FED261211-MAINTAIN")).toBe(false);
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
    expect(await desk.confirmFromFeed(waiting.intentId)).toEqual({ ok: false, error: "unknown-intent" });
  });

  it("does not let the feed confirm intents from other sources", async () => {
    const { desk } = await readyDesk();
    const other = await desk.proposeTrade({ ...propose("yes", 500), source: "x" });
    expect(other.kind).toBe("needs-approval");
    expect(await desk.confirmFromFeed(other.intentId)).toEqual({ ok: false, error: "unknown-intent" });
  });
});

});
