import { describe, expect, it, vi } from "vitest";
import type { ConfirmResult, Desk } from "@/features/desk";
import { instrumentSymbol, usdCents } from "@/shared";
import type { DecisionLogEntry, DeskSnapshot, MatchView, PendingView, PolicyView } from "@/shared";
import { createDesk } from "@/features/desk";
import { createPolicy } from "@/features/guardrails";
import type { UsdcLedger } from "@/features/ledger";
import { ok } from "@/features/markets";
import type { GeminiMarketsClient, MarketEvent } from "@/features/markets";
import { createXBot } from "./bot";
import { createFakeXClient } from "./fake-client";
import type { NewsPost } from "./types";

const SYMBOL = "GEMI-FED261211-MAINTAIN";

const matched: MatchView = {
  kind: "matched",
  reasons: [],
  market: {
    eventTicker: "FED261211",
    eventTitle: "Fed decision in December?",
    contractLabel: "Fed maintains rate",
    instrumentSymbol: SYMBOL,
    yesCents: 62,
    noCents: 40,
    marketState: "open",
  },
};

const policy: PolicyView = {
  dailyCapCents: 2000,
  spentCents: 300,
  remainingCents: 1700,
  autoApproveMaxCents: 200,
  perTradeMaxCents: 1000,
  killSwitch: false,
  marketAllowlist: [SYMBOL],
  marketCategories: ["Economics"],
  senderAllowlist: ["@Priscilla", "@Kelly"],
};

const marketEvent: MarketEvent = {
  ticker: "FED261211",
  title: "Fed decision in December?",
  category: "Economics",
  status: "active",
  expiryDate: null,
  tags: ["fed"],
  contracts: [
    {
      instrumentSymbol: instrumentSymbol(SYMBOL),
      label: "Fed maintains rate",
      marketState: "open",
      status: "active",
      prices: { bestBidCents: 60, bestAskCents: 62, lastTradeCents: 62, buyYesCents: 62, buyNoCents: 40 },
      limits: { quantityIncrementHundredths: 1n, quantityMinimumHundredths: 1n, priceIncrementCents: 1n, priceMinimumCents: 1n },
    },
  ],
};

const post: NewsPost = {
  id: "news-1",
  text: "Fed signals it could hold rates steady",
  authorHandle: "Reuters",
  url: "https://reuters.test/a",
  postedAt: new Date("2026-11-17T11:59:00Z"),
};

function entryFor(kind: DecisionLogEntry["kind"], senderId: string, extra: Partial<DecisionLogEntry> = {}): DecisionLogEntry {
  return {
    entryId: `entry-${senderId}`,
    kind,
    spokenReason: `${kind} reason.`,
    intentId: `intent-${senderId}-${kind}`,
    symbol: SYMBOL,
    outcome: "yes",
    notionalCents: 200,
    senderId,
    source: "x",
    at: "2026-11-17T12:00:00.000Z",
    ...extra,
  };
}

interface DeskScript {
  readonly match?: MatchView;
  readonly propose?: (senderId: string) => DecisionLogEntry;
}

function fakeDesk(script: DeskScript = {}) {
  let pending: PendingView[] = [];
  const proposeTrade = vi.fn<Desk["proposeTrade"]>((request) => {
    const entry = (script.propose ?? ((sender) => entryFor("approve", sender)))(request.senderId);
    if (entry.kind === "needs-approval") {
      pending = [
        ...pending,
        { intentId: entry.intentId, symbol: SYMBOL, outcome: "yes", notionalCents: 200, senderId: request.senderId, createdAt: entry.at },
      ];
    }
    return Promise.resolve(entry);
  });
  const confirmPending = vi.fn<Desk["confirmPending"]>((intentId, approverId): Promise<ConfirmResult> => {
    if (!pending.some((item) => item.intentId === intentId)) return Promise.resolve({ ok: false, error: "unknown-intent" });
    pending = pending.filter((item) => item.intentId !== intentId);
    return Promise.resolve({ ok: true, entry: entryFor("approve", approverId, { intentId }) });
  });
  const submitNews = vi.fn<Desk["submitNews"]>(() => Promise.resolve(script.match ?? matched));
  const getSnapshot = vi.fn<Desk["getSnapshot"]>(() =>
    Promise.resolve({ news: null, match: matched, policy, pending, log: [], ledger: { configured: false, missing: [] } } satisfies DeskSnapshot),
  );
  const desk: Desk = {
    submitNews, proposeTrade, confirmPending, getSnapshot, setKillSwitch: vi.fn(),
    matchPost: vi.fn(), isCardFor: vi.fn(), quote: vi.fn(), buyFromFeed: vi.fn(), confirmFromFeed: vi.fn(),
  };
  return { desk, proposeTrade, confirmPending, submitNews };
}

function setup(script: DeskScript = {}) {
  const client = createFakeXClient();
  const fixture = fakeDesk(script);
  let ids = 0;
  const bot = createXBot({
    desk: fixture.desk,
    client,
    now: () => new Date("2026-11-17T12:00:00Z"),
    idGen: () => `gen-${String(++ids)}`,
    botHandle: "@NewsToTradeDesk",
  });
  return { bot, client, ...fixture };
}

const reply = (id: string, text: string, authorHandle = "@priscilla", inReplyToId = "news-1") => ({ id, inReplyToId, authorHandle, text });

describe("ingestNewsPost", () => {
  it("submits the news to the desk and posts the composed reply into the thread", async () => {
    const { bot, client, submitNews } = setup();
    const result = await bot.ingestNewsPost(post);
    expect(result).toEqual({ kind: "ingested", match: matched, posted: true });
    expect(submitNews).toHaveBeenCalledWith({
      id: "news-1",
      text: post.text,
      author: "@reuters",
      url: post.url,
      postedAt: post.postedAt,
    });
    expect(client.posted()).toHaveLength(1);
    expect(client.posted()[0]).toMatchObject({ inReplyToId: "news-1" });
    expect(client.posted()[0]?.text).toContain("Yes 62¢ · No 40¢");
    const [thread] = bot.getThreads();
    expect(thread?.market).toEqual(matched.market);
    expect(thread?.messages.map((message) => message.role)).toEqual(["news", "bot"]);
    expect(thread?.messages[1]).toMatchObject({ author: "@newstotradedesk", postedToX: false });
  });

  it("records a bot note but posts nothing to X when no market matched", async () => {
    const { bot, client } = setup({ match: { kind: "no-match", reason: "nothing" } });
    const result = await bot.ingestNewsPost(post);
    expect(result).toEqual({ kind: "ingested", match: { kind: "no-match", reason: "nothing" }, posted: false });
    expect(client.posted()).toEqual([]);
    const [thread] = bot.getThreads();
    expect(thread?.market).toBeNull();
    expect(thread?.messages.map((message) => message.role)).toEqual(["news", "bot"]);
    expect(thread?.messages[1]?.text).toContain("No allowlisted Gemini market matched");
  });

  it("ignores a news post it has already ingested", async () => {
    const { bot, client, submitNews } = setup();
    await bot.ingestNewsPost(post);
    expect(await bot.ingestNewsPost(post)).toEqual({ kind: "duplicate" });
    expect(submitNews).toHaveBeenCalledTimes(1);
    expect(client.posted()).toHaveLength(1);
    expect(bot.getThreads()).toHaveLength(1);
  });

  it("allows a retry after the desk failed", async () => {
    const { bot, submitNews } = setup();
    submitNews.mockRejectedValueOnce(new Error("down"));
    await expect(bot.ingestNewsPost(post)).rejects.toThrow("down");
    expect(await bot.ingestNewsPost(post)).toMatchObject({ kind: "ingested" });
  });

  it("keeps the failed post visible with the error kind when X rejects the reply", async () => {
    const { bot, client } = setup();
    vi.spyOn(client, "postReply").mockResolvedValueOnce({ ok: false, error: { kind: "rate-limited" } });
    expect(await bot.ingestNewsPost(post)).toMatchObject({ posted: false });
    expect(bot.getThreads()[0]?.messages[1]).toMatchObject({ role: "bot", postedToX: false, postError: "rate-limited" });
  });
});

describe("handleReply bets", () => {
  it("proposes the trade with the thread's market and the allowlist-matching sender id, then replies with the proof", async () => {
    const { bot, client, proposeTrade } = setup({
      propose: (sender) =>
        entryFor("approve", sender, {
          signature: "SigSigSigSigSig1234",
          explorerUrl: "https://explorer.test/tx/1",
          ticket: { ticketId: "ticket-abcdef", symbol: SYMBOL, outcome: "yes", quantity: "3", price: "62", mode: "paper" },
        }),
    });
    await bot.ingestNewsPost(post);
    expect(await bot.handleReply(reply("r1", "@NewsToTradeDesk Yes $2", "PRISCILLA"))).toBe("handled");
    expect(proposeTrade).toHaveBeenCalledWith({
      instrumentSymbol: SYMBOL,
      outcome: "yes",
      notionalCents: 200,
      source: "x",
      senderId: "@Priscilla",
    });
    const text = client.posted().at(-1)?.text ?? "";
    expect(text).toContain("approve reason.");
    expect(text).toContain("Paper ticket ticket-a");
    expect(text).toContain("https://explorer.test/tx/1");
    expect(client.posted().at(-1)?.inReplyToId).toBe("r1");
    const messages = bot.getThreads()[0]?.messages ?? [];
    expect(messages.map((message) => message.role)).toEqual(["news", "bot", "user", "bot"]);
    expect(messages[2]).toMatchObject({ author: "@priscilla", text: "@NewsToTradeDesk Yes $2" });
    expect(messages[3]).toMatchObject({ decisionKind: "approve", ticketId: "ticket-abcdef" });
    expect(bot.getThreads()[0]?.outcomes).toEqual([
      { intentId: "intent-@Priscilla-approve", kind: "approve", at: "2026-11-17T12:00:00.000Z" },
    ]);
  });

  it.each(["@@PRISCILLA", " @priscilla", "@priscilla ", "@way_too_long_handle_x", "not a handle"])(
    "rejects bets and approvals from malformed handle %j before they reach the desk",
    async (author) => {
      const { bot, client, proposeTrade, confirmPending } = setup({ propose: (sender) => entryFor("needs-approval", sender) });
      await bot.ingestNewsPost(post);
      await bot.handleReply(reply("own", "yes 5"));
      await bot.handleReply(reply("bet", "yes 2", author));
      expect(client.posted().at(-1)?.text).toContain("Only allowlisted senders");
      await bot.handleReply(reply("approval", "approve", author));
      expect(proposeTrade).toHaveBeenCalledTimes(1);
      expect(confirmPending).not.toHaveBeenCalled();
      expect(client.posted().at(-1)?.text).toContain("Only allowlisted senders");
    },
  );

  it("forwards a valid non-allowlisted handle to the desk in normalized form and replies with the desk reason", async () => {
    const { bot, client, proposeTrade } = setup({
      propose: (sender) => entryFor("refuse", sender, { code: "unauthorized-sender", spokenReason: "Not authorized." }),
    });
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("bet", "yes 2", "@RandomStranger"));
    expect(proposeTrade).toHaveBeenCalledWith({
      instrumentSymbol: SYMBOL,
      outcome: "yes",
      notionalCents: 200,
      source: "x",
      senderId: "@randomstranger",
    });
    expect(client.posted().at(-1)?.text).toContain("Not authorized.");
  });

  it("refuses approve and status from non-allowlisted handles at the bot", async () => {
    const { bot, client, proposeTrade, confirmPending } = setup();
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("approval", "approve", "@stranger"));
    expect(client.posted().at(-1)?.text).toContain("Only allowlisted senders");
    await bot.handleReply(reply("status", "status", "@stranger"));
    expect(client.posted().at(-1)?.text).toContain("Only allowlisted senders");
    expect(proposeTrade).not.toHaveBeenCalled();
    expect(confirmPending).not.toHaveBeenCalled();
  });

  it("records an unauthorized-sender refusal in the real desk log and moves no funds for a non-allowlisted bet", async () => {
    const debit = vi.fn<UsdcLedger["debit"]>();
    const markets = {
      searchEvents: vi.fn<GeminiMarketsClient["searchEvents"]>(() => Promise.resolve(ok({ events: [marketEvent], total: 1 }))),
      getEvent: vi.fn<GeminiMarketsClient["getEvent"]>(() => Promise.resolve(ok(marketEvent))),
    };
    const created = createPolicy({
      dailyCap: usdCents(2000),
      autoApproveMax: usdCents(200),
      perTradeMax: usdCents(1000),
      marketAllowlist: new Set([instrumentSymbol(SYMBOL)]),
      marketCategories: new Set(["Economics"]),
      senderAllowlist: new Set(["@Priscilla"]),
      killSwitch: false,
    });
    if (!created.ok) throw new Error("invalid policy");
    const desk = createDesk({
      policy: created.value,
      feed: { operatorId: "@Priscilla", grok: { apiKey: undefined, model: "grok-test" } },
      markets,
      ledger: { debit, balance: vi.fn() },
      ledgerView: { configured: false, missing: [] },
      now: () => new Date("2026-11-17T12:00:00Z"),
      idGen: () => "desk-id",
    });
    const client = createFakeXClient();
    const bot = createXBot({ desk, client, now: () => new Date("2026-11-17T12:00:00Z"), idGen: () => "gen", botHandle: "@NewsToTradeDesk" });
    await bot.ingestNewsPost({ ...post, text: "Fed officials signal they could hold rates steady at the December FOMC meeting" });
    await bot.handleReply(reply("bet", "yes 2", "@RandomStranger"));
    const { log, policy: after } = await desk.getSnapshot();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "refuse", code: "unauthorized-sender", senderId: "@randomstranger" });
    expect(after.spentCents).toBe(0);
    expect(debit).not.toHaveBeenCalled();
    expect(client.posted().at(-1)?.text).toContain(log[0]?.spokenReason);
  });

  it("asks for approval when the desk needs it", async () => {
    const { bot, client } = setup({ propose: (sender) => entryFor("needs-approval", sender) });
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("r1", "yes 5"));
    expect(client.posted().at(-1)?.text).toContain("\"approve\"");
  });

  it("explains when the thread has no market and does not post to X", async () => {
    const { bot, client, proposeTrade } = setup({ match: { kind: "no-match", reason: "nothing" } });
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("r1", "yes 2"));
    expect(proposeTrade).not.toHaveBeenCalled();
    expect(client.posted()).toEqual([]);
    expect(bot.getThreads()[0]?.messages.at(-1)?.text).toContain("No Gemini market is attached");
  });

  it("replies with a failure notice when the desk throws", async () => {
    const { bot, client, proposeTrade } = setup();
    proposeTrade.mockRejectedValueOnce(new Error("boom"));
    await bot.ingestNewsPost(post);
    expect(await bot.handleReply(reply("r1", "yes 2"))).toBe("handled");
    expect(client.posted().at(-1)?.text).toContain("Nothing was executed");
  });

  it("does not trade twice for the same reply id, even when processed concurrently", async () => {
    const { bot, proposeTrade } = setup();
    await bot.ingestNewsPost(post);
    const results = await Promise.all([bot.handleReply(reply("r1", "yes 2")), bot.handleReply(reply("r1", "yes 2"))]);
    expect(results.toSorted()).toEqual(["duplicate", "handled"]);
    expect(await bot.handleReply(reply("r1", "yes 2"))).toBe("duplicate");
    expect(proposeTrade).toHaveBeenCalledTimes(1);
    expect(bot.getThreads()[0]?.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });
});

describe("handleReply routing", () => {
  it("routes replies to any message in the thread, including bot replies", async () => {
    const { bot, proposeTrade } = setup();
    await bot.ingestNewsPost(post);
    const botMessageId = bot.getThreads()[0]?.messages[1]?.id ?? "";
    expect(await bot.handleReply(reply("r1", "yes 2", "@priscilla", botMessageId))).toBe("handled");
    expect(await bot.handleReply(reply("r2", "yes 2", "@priscilla", "r1"))).toBe("handled");
    expect(proposeTrade).toHaveBeenCalledTimes(2);
  });

  it("keeps existing messages attached to their original thread when ids collide", async () => {
    const { bot, proposeTrade } = setup();
    await bot.ingestNewsPost(post);
    await bot.ingestNewsPost({ ...post, id: "news-2" });
    const firstBotReply = bot.getThreads().find((thread) => thread.id === post.id)?.messages[1]?.id ?? "";
    expect(await bot.handleReply(reply(firstBotReply, "yes 2", "@priscilla", "news-2"))).toBe("duplicate");
    expect(await bot.ingestNewsPost({ ...post, id: firstBotReply })).toEqual({ kind: "duplicate" });
    expect(proposeTrade).not.toHaveBeenCalled();
    await bot.handleReply(reply("r1", "yes 2", "@priscilla", firstBotReply));
    expect(bot.getThreads().find((thread) => thread.id === post.id)?.outcomes).toHaveLength(1);
  });

  it("does not let a generated bot id replace an existing thread root", async () => {
    const { bot } = setup();
    await bot.ingestNewsPost({ ...post, id: "fake-2" });
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("r1", "yes 2", "@priscilla", "fake-2"));
    expect(bot.getThreads().find((thread) => thread.id === "fake-2")?.outcomes).toHaveLength(1);
    expect(bot.getThreads().find((thread) => thread.id === post.id)?.outcomes).toHaveLength(0);
  });

  it("reports replies to unknown posts as unrouted without calling the desk", async () => {
    const { bot, proposeTrade } = setup();
    await bot.ingestNewsPost(post);
    expect(await bot.handleReply(reply("r1", "yes 2", "@priscilla", "elsewhere"))).toBe("unrouted");
    expect(proposeTrade).not.toHaveBeenCalled();
  });

  it("ignores the bot's own posts", async () => {
    const { bot, proposeTrade } = setup();
    await bot.ingestNewsPost(post);
    expect(await bot.handleReply(reply("r1", "yes 2", "@newstotradedesk"))).toBe("ignored");
    expect(proposeTrade).not.toHaveBeenCalled();
  });

  it("records unknown commands without replying", async () => {
    const { bot, client, proposeTrade } = setup();
    await bot.ingestNewsPost(post);
    const before = client.posted().length;
    expect(await bot.handleReply(reply("r1", "nice one, thanks"))).toBe("handled");
    expect(client.posted()).toHaveLength(before);
    expect(proposeTrade).not.toHaveBeenCalled();
    expect(bot.getThreads()[0]?.messages.at(-1)).toMatchObject({ role: "user", text: "nice one, thanks" });
  });
});

describe("handleReply approve and status", () => {
  it("confirms the latest pending intent in the thread belonging to the approving sender", async () => {
    const { bot, client, confirmPending } = setup({ propose: (sender) => entryFor("needs-approval", sender) });
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("r1", "yes 5", "@priscilla"));
    await bot.handleReply(reply("r2", "no 5", "@Kelly"));
    await bot.handleReply(reply("r3", "approve", "@priscilla"));
    expect(confirmPending).toHaveBeenCalledTimes(1);
    expect(confirmPending).toHaveBeenCalledWith("intent-@Priscilla-needs-approval", "@Priscilla");
    expect(client.posted().at(-1)?.text).toContain("approve reason.");
    expect(bot.getThreads()[0]?.outcomes.at(-1)?.kind).toBe("approve");
  });

  it("does not confirm intents from other threads", async () => {
    const { bot, client, confirmPending } = setup({ propose: (sender) => entryFor("needs-approval", sender) });
    await bot.ingestNewsPost(post);
    await bot.ingestNewsPost({ ...post, id: "news-2" });
    await bot.handleReply(reply("r1", "yes 5", "@priscilla", "news-1"));
    await bot.handleReply(reply("r2", "approve", "@priscilla", "news-2"));
    expect(confirmPending).not.toHaveBeenCalled();
    expect(client.posted().at(-1)?.text).toContain("Nothing is waiting for approval");
  });

  it("refuses approve from non-allowlisted senders without calling the desk", async () => {
    const { bot, client, confirmPending } = setup({ propose: (sender) => entryFor("needs-approval", sender) });
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("r1", "yes 5"));
    await bot.handleReply(reply("r2", "do it", "@stranger"));
    expect(confirmPending).not.toHaveBeenCalled();
    expect(client.posted().at(-1)?.text).toContain("Only allowlisted senders");
  });

  it("answers status for allowlisted senders and refuses others", async () => {
    const { bot, client } = setup({ propose: (sender) => entryFor("needs-approval", sender) });
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("r1", "yes 5"));
    await bot.handleReply(reply("r2", "status"));
    expect(client.posted().at(-1)?.text).toBe("Budget left $17.00; spent $3.00 of $20.00 today; 1 pending approval.");
    await bot.handleReply(reply("r3", "status", "@stranger"));
    expect(client.posted().at(-1)?.text).toContain("Only allowlisted senders");
  });

  it("does not call the desk at all for a non-allowlisted status request beyond reading the policy", async () => {
    const { bot, proposeTrade, confirmPending } = setup();
    await bot.ingestNewsPost(post);
    await bot.handleReply(reply("r1", "status", "@stranger"));
    expect(proposeTrade).not.toHaveBeenCalled();
    expect(confirmPending).not.toHaveBeenCalled();
  });
});

describe("pollMentions", () => {
  it("handles injected replies once and advances the cursor", async () => {
    const { bot, client, proposeTrade } = setup();
    await bot.ingestNewsPost(post);
    client.injectMention({ id: "m1", text: "@bot yes 2", authorHandle: "@priscilla", inReplyToId: "news-1" });
    client.injectMention({ id: "m2", text: "@bot hello", authorHandle: "@priscilla" });
    client.injectMention({ id: "m3", text: "yes 2", authorHandle: "@priscilla", inReplyToId: "nowhere" });
    expect(await bot.pollMentions()).toEqual({ fetched: 3, handled: 1, duplicates: 0, unrouted: 2, ignored: 0 });
    expect(await bot.pollMentions()).toEqual({ fetched: 0, handled: 0, duplicates: 0, unrouted: 0, ignored: 0 });
    expect(proposeTrade).toHaveBeenCalledTimes(1);
  });

  it("reports the error kind when X cannot be reached", async () => {
    const { bot, client } = setup();
    vi.spyOn(client, "fetchMentions").mockResolvedValueOnce({ ok: false, error: { kind: "unauthorized" } });
    expect(await bot.pollMentions()).toEqual({ fetched: 0, handled: 0, duplicates: 0, unrouted: 0, ignored: 0, error: "unauthorized" });
  });
});

describe("getStatus", () => {
  it("reports the client mode and the missing configuration names", () => {
    const fixture = fakeDesk();
    const bot = createXBot({
      desk: fixture.desk,
      client: createFakeXClient(),
      now: () => new Date(),
      idGen: () => "id",
      botHandle: "@bot",
      configuredMissing: ["X_API_KEY"],
    });
    expect(bot.getStatus()).toEqual({ mode: "fake", configuredMissing: ["X_API_KEY"] });
  });
});
