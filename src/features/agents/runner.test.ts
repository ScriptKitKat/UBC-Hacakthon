import { describe, expect, it, vi } from "vitest";
import type { Desk } from "@/features/desk";
import { createMemoryHistory } from "@/features/history";
import { fail, ok } from "@/features/markets";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { createMemoryFileSystem } from "@/features/storage";
import { instrumentSymbol } from "@/shared";
import type { DecisionLogEntry, DeepDiveResult } from "@/shared";
import type { DeskBudget } from "./budget";
import { runAgentTick } from "./runner";
import type { AgentRunnerDeps } from "./runner";
import { openAgentStore } from "./store";
import type { AgentDraft } from "./store";

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
  return { ticker: "BTC", title: "BTC", category: "Crypto", status: "active", expiryDate: "2026-12-31T00:00:00.000Z", description: "", subcategory: null, volume: 1000, volume24h, tags: [], contracts: [contract(yes)], createdAt: "2026-11-09T18:00:00.000Z" };
}

function entry(kind: DecisionLogEntry["kind"], outcome: "yes" | "no"): DecisionLogEntry {
  return { entryId: "e1", kind, spokenReason: `${kind} reason.`, intentId: "i1", symbol: SYMBOL, outcome, notionalCents: 200, senderId: "operator", source: "desk", at: NOW.toISOString() };
}

const DELIVERED: DeepDiveResult = { status: "delivered", alreadyPurchased: false, trace: [], failureReason: null, brief: null, purchase: null };

async function setup(options: { readonly yesNow: number; readonly yesBefore: number; readonly volume24h?: number; readonly draft?: Partial<AgentDraft>; readonly allowAutonomous?: boolean }) {
  const store = openAgentStore({ fs: createMemoryFileSystem(), path: "agents.json", now: () => NOW, id: () => "agent-1" });
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
    desk: { proposeTrade, buyDeepDive, getSnapshot: vi.fn<Desk["getSnapshot"]>() },
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
    const tick = await runAgentTick(deps, agent, DESK, NOW);
    expect(tick).toMatchObject({ fired: ["oddsMove"], action: "notify", messageSource: "template" });
    expect(tick.message).toContain("20 points");
    expect(proposeTrade).not.toHaveBeenCalled();
    expect((await store.get("agent-1"))?.activity.map((item) => item.kind)).toEqual(["message"]);
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
});
