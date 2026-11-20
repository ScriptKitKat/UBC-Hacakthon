import { describe, expect, it, vi } from "vitest";
import type { Desk } from "@/features/desk";
import { createMemoryHistory } from "@/features/history";
import { fail, ok } from "@/features/markets";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { createMemoryFileSystem } from "@/features/storage";
import type { XSignals } from "@/features/xfeed";
import { agentCycleReportSchema, instrumentSymbol } from "@/shared";
import type { DecisionLogEntry, DeepDiveResult } from "@/shared";
import type { DeskBudget } from "./budget";
import { runAgentCycle, runAgentTick } from "./runner";
import type { AgentRunnerDeps } from "./runner";
import { openAgentStore } from "./store";
import type { AgentDraft } from "./store";
import { AGENT_LOOP_INTERVAL_MS, agentCycle, startAgentLoop } from "./loop";

const NOW = new Date("2026-11-19T18:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const SYMBOL = "GEMI-BTC-YES";
const DESK: DeskBudget = { dailyCapCents: 2000, remainingCents: 2000, perTradeMaxCents: 1000, autoApproveMaxCents: 200 };

function contract(yes: number): MarketContract {
  return {
    instrumentSymbol: instrumentSymbol(SYMBOL),
    label: "Yes",
    description: "",
    expiryDate: "2026-12-31T00:00:00.000Z",
    marketState: "open",
    status: "active",
    prices: { bestBidCents: null, bestAskCents: null, lastTradeCents: null, buyYesCents: yes, buyNoCents: null, sellYesCents: null, sellNoCents: null },
    limits: null,
  };
}

function event(yes: number, volume24h: number): MarketEvent {
  return { ticker: "BTC", title: "Bitcoin price today?", category: "Crypto", status: "active", expiryDate: "2026-12-31T00:00:00.000Z", description: "", subcategory: null, volume: 1000, volume24h, tags: [], contracts: [contract(yes)], createdAt: "2026-11-09T18:00:00.000Z" };
}

function entry(kind: DecisionLogEntry["kind"], outcome: "yes" | "no"): DecisionLogEntry {
  return { entryId: "e1", kind, spokenReason: `${kind} reason.`, intentId: "i1", symbol: SYMBOL, outcome, notionalCents: 200, senderId: "operator", source: "desk", at: NOW.toISOString() };
}

const DELIVERED: DeepDiveResult = { status: "delivered", alreadyPurchased: false, trace: [], failureReason: null, brief: null, purchase: null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function setup(options: { readonly yesNow: number; readonly yesBefore: number; readonly volume24h?: number; readonly draft?: Partial<AgentDraft>; readonly allowAutonomous?: boolean }) {
  let idCount = 0;
  const store = openAgentStore({ fs: createMemoryFileSystem(), path: "agents.json", now: () => NOW, id: () => `agent-${String(++idCount)}` });
  const agent = await store.create({ eventTicker: "BTC", instrumentSymbol: SYMBOL, name: "Scout", ...options.draft });
  const history = createMemoryHistory();
  history.watch(SYMBOL);
  history.record(SYMBOL, { atMs: NOW.getTime() - DAY_MS - 60_000, yesCents: options.yesBefore, bidCents: null, askCents: null });
  const proposeTrade = vi.fn<Desk["proposeTrade"]>((request) => Promise.resolve(entry(request.requireApproval === true ? "needs-approval" : "approve", request.outcome)));
  const buyDeepDive = vi.fn<Desk["buyDeepDive"]>(() => Promise.resolve(DELIVERED));
  const getEvent: GeminiMarketsClient["getEvent"] = () => Promise.resolve(ok(event(options.yesNow, options.volume24h ?? 50)));
  const deps: AgentRunnerDeps = {
    store,
    markets: { getEvent, candles: () => Promise.resolve(fail({ kind: "network" })) },
    history,
    desk: {
      proposeTrade,
      buyDeepDive,
      getSnapshot: vi.fn<Desk["getSnapshot"]>(() => Promise.resolve({
        policy: { dailyCapCents: DESK.dailyCapCents, remainingCents: DESK.remainingCents, perTradeMaxCents: DESK.perTradeMaxCents, autoApproveMaxCents: DESK.autoApproveMaxCents },
      } as Awaited<ReturnType<Desk["getSnapshot"]>>)),
    },
    grok: { apiKey: undefined, model: "unused" },
    fetch: vi.fn<typeof fetch>(),
    operatorId: "operator",
    ...(options.allowAutonomous === undefined ? {} : { allowAutonomous: options.allowAutonomous }),
  };
  return { store, agent, deps, proposeTrade, buyDeepDive };
}

describe("runAgentTick", () => {
  it("tells the owner about a move without proposing a trade when the agent only watches", async () => {
    const { agent, deps, proposeTrade, store } = await setup({ yesNow: 60, yesBefore: 40, draft: { permission: "watch" } });
    const xFeed = { signals: vi.fn(() => Promise.resolve(undefined)) };
    const tick = await runAgentTick({ ...deps, xFeed }, agent, DESK, NOW);
    expect(tick).toMatchObject({ fired: ["oddsMove"], action: "notify", messageSource: "template" });
    expect(tick.message).toContain("20 points");
    expect(proposeTrade).not.toHaveBeenCalled();
    expect(xFeed.signals).not.toHaveBeenCalled();
    expect((await store.get("agent-1"))?.activity.map((item) => item.kind)).toEqual(["message"]);
  });

  it("reports when market data could not be loaded", async () => {
    const { agent, deps } = await setup({ yesNow: 60, yesBefore: 40 });
    vi.spyOn(deps.markets, "getEvent").mockResolvedValue(fail({ kind: "network" }));

    const tick = await runAgentTick(deps, agent, DESK, NOW);

    expect(tick).toMatchObject({ fired: [], skipped: [], marketUnavailable: true, action: "none" });
    expect(agentCycleReportSchema.parse({ ran: 1, ticks: [tick] }).ticks[0]?.marketUnavailable).toBe(true);
  });

  it("suggests the side the price moved toward and always asks for approval", async () => {
    const up = await setup({ yesNow: 60, yesBefore: 40, draft: { permission: "suggest", maxPerBetCents: 200 } });
    expect((await runAgentTick(up.deps, up.agent, DESK, NOW)).action).toBe("suggest");
    expect(up.proposeTrade).toHaveBeenCalledWith(expect.objectContaining({ outcome: "yes", notionalCents: 200, requireApproval: true, seenPriceCents: 60 }));
    expect((await up.store.get("agent-1"))?.spentTodayCents).toBe(0);

    const down = await setup({ yesNow: 40, yesBefore: 60, draft: { permission: "suggest" } });
    await runAgentTick(down.deps, down.agent, DESK, NOW);
    expect(down.proposeTrade).toHaveBeenCalledWith(expect.objectContaining({ outcome: "no", requireApproval: true }));
  });

  it("holds instead of picking a side when volume spikes and the price has not moved", async () => {
    const { agent, deps, proposeTrade, store } = await setup({ yesNow: 50, yesBefore: 50, volume24h: 600, draft: { permission: "suggest" } });
    const tick = await runAgentTick(deps, agent, DESK, NOW);
    expect(tick).toMatchObject({ fired: ["volumeSpike"], action: "hold" });
    expect(proposeTrade).not.toHaveBeenCalled();
    expect((await store.get("agent-1"))?.activity.map((item) => item.kind)).toEqual(["message", "refused"]);
  });

  it("records a desk refusal as refused, not as a suggestion", async () => {
    const { agent, deps, proposeTrade, store } = await setup({ yesNow: 60, yesBefore: 40, draft: { permission: "suggest" } });
    proposeTrade.mockResolvedValue(entry("refuse", "yes"));
    const tick = await runAgentTick(deps, agent, DESK, NOW);
    expect(tick.action).toBe("hold");
    expect((await store.get("agent-1"))?.activity.map((item) => item.kind)).toEqual(["message", "refused"]);
  });

  it("refuses to bet on its own when autonomous betting is disabled for the run", async () => {
    const { agent, deps, proposeTrade } = await setup({ yesNow: 60, yesBefore: 40, draft: { permission: "autonomous" }, allowAutonomous: false });
    expect((await runAgentTick(deps, agent, DESK, NOW)).action).toBe("hold");
    expect(proposeTrade).not.toHaveBeenCalled();
  });

  it("bets within the auto-approve limit, then skips the brief once the day's budget is spent", async () => {
    const { agent, deps, proposeTrade, buyDeepDive, store } = await setup({
      yesNow: 60,
      yesBefore: 40,
      draft: { permission: "autonomous", dailyBudgetCents: 200, maxPerBetCents: 500, writeBriefs: true },
    });
    const tick = await runAgentTick(deps, agent, DESK, NOW);
    expect(tick.action).toBe("autonomous");
    expect(proposeTrade).toHaveBeenCalledWith(expect.objectContaining({ outcome: "yes", notionalCents: 200 }));
    expect(buyDeepDive).not.toHaveBeenCalled();
    const saved = await store.get("agent-1");
    expect(saved?.spentTodayCents).toBe(200);
    expect(saved?.activity.map((item) => item.kind)).toEqual(["message", "bet", "refused"]);
  });

  it("runs X triggers as notifications and records breaking post links", async () => {
    const triggers = {
      oddsMove: false,
      volumeSpike: false,
      xMentions: true,
      breakingNews: true,
      oddsCross: false,
      oddsCrossLevel: null,
      endingSoon: false,
    };
    const { agent, deps, proposeTrade, buyDeepDive, store } = await setup({
      yesNow: 55,
      yesBefore: 55,
      draft: { permission: "autonomous", writeBriefs: false, triggers },
    });
    const signals: XSignals = {
      lastHourCount: 30,
      baselineHourlyCount: 10,
      breakingPost: {
        id: "post-1",
        text: "An official statement.",
        authorUsername: "reporter",
        url: "https://x.com/reporter/status/post-1",
      },
    };
    const xFeed = { signals: vi.fn(() => Promise.resolve(signals)) };
    const tick = await runAgentTick({ ...deps, xFeed }, agent, DESK, NOW);
    expect(tick).toMatchObject({ fired: ["xMentions", "breakingNews"], action: "notify" });
    expect(tick.message).toContain("Posts about this on X jumped to 30 in the last hour, about 3.0× the usual rate.");
    expect(tick.message).toContain("Breaking on X from @reporter: “An official statement.”.");
    expect(xFeed.signals).toHaveBeenCalledWith("bitcoin");
    expect(proposeTrade).not.toHaveBeenCalled();
    expect(buyDeepDive).not.toHaveBeenCalled();
    expect(await store.get(agent.id)).toMatchObject({
      lastBreakingPostId: "post-1",
      activity: [expect.objectContaining({ kind: "message", url: "https://x.com/reporter/status/post-1" })],
    });
  });
});

describe("runAgentCycle", () => {
  it("runs only the selected agent", async () => {
    const { agent, deps, store } = await setup({ yesNow: 55, yesBefore: 50, draft: { permission: "watch" } });
    const other = await store.create({ eventTicker: "ETH", instrumentSymbol: "GEMI-ETH-YES", name: "Other", permission: "watch" });
    const report = await runAgentCycle(deps, other.id);
    expect(report).toMatchObject({ ran: 1, ticks: [{ agentId: other.id }] });
    expect(await store.get(agent.id)).toMatchObject({ lastRunAt: null });
    expect(await store.get(other.id)).toMatchObject({ lastRunAt: NOW.toISOString() });
  });

  it("coalesces overlapping untargeted runs", async () => {
    const { deps } = await setup({ yesNow: 55, yesBefore: 50, draft: { permission: "watch" } });
    const serializedDeps: AgentRunnerDeps = { ...deps, now: () => NOW };
    const getEvent = vi.spyOn(serializedDeps.markets, "getEvent");
    const run = agentCycle(serializedDeps);
    const first = run();
    const second = run();

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it("queues a targeted run behind the in-flight loop cycle", async () => {
    const { agent, deps, proposeTrade } = await setup({
      yesNow: 60,
      yesBefore: 40,
      draft: { permission: "autonomous", maxPerBetCents: 200 },
    });
    const serializedDeps: AgentRunnerDeps = { ...deps, now: () => NOW };
    const trade = deferred<DecisionLogEntry>();
    const tradeStarted = deferred<undefined>();
    proposeTrade.mockImplementation(() => {
      tradeStarted.resolve(undefined);
      return trade.promise;
    });
    const getEvent = vi.spyOn(serializedDeps.markets, "getEvent");
    vi.useFakeTimers();
    const timer = startAgentLoop(serializedDeps);

    try {
      await vi.advanceTimersByTimeAsync(AGENT_LOOP_INTERVAL_MS);
      await tradeStarted.promise;
      const targeted = agentCycle(serializedDeps)(agent.id);
      await vi.advanceTimersByTimeAsync(0);
      expect(getEvent).toHaveBeenCalledTimes(1);
      expect(proposeTrade).toHaveBeenCalledTimes(1);

      trade.resolve(entry("approve", "yes"));
      const report = await targeted;

      expect(getEvent).toHaveBeenCalledTimes(2);
      expect(proposeTrade).toHaveBeenCalledTimes(1);
      expect(report.ticks[0]?.skipped).toEqual([{ id: "oddsMove", reason: "already reported this move" }]);
    } finally {
      clearInterval(timer);
      vi.useRealTimers();
    }
  });
});
