import { describe, expect, expectTypeOf, it } from "vitest";
import { instrumentSymbol, usdCents } from "@/shared";
import type { TradeIntent } from "@/shared";
import { DEFAULT_MARKET_CATEGORIES, applyApproved, confirm, createPolicy, evaluate, evaluateResearch, marketPolicyRefusal, policyStateFromSpends, remainingBudget, rollDay } from "./index";
import type { PolicyConfig, PolicyState } from "./index";

const now = new Date("2026-11-17T23:59:59Z");
const symbol = instrumentSymbol("RATE-DEC");
const market = { instrumentSymbol: symbol, marketState: "open", status: "active", eventStatus: "active", category: "Economics", limitPrice: usdCents(50) };
const state: PolicyState = {
  day: "2026-11-17", spentToday: usdCents(0), reservedToday: usdCents(0), seenIntentIds: new Set(),
};
const config: PolicyConfig = {
  dailyCap: usdCents(2000), perTradeMax: usdCents(1000), autoApproveMax: usdCents(500),
  marketAllowlist: new Set(), marketCategories: new Set(DEFAULT_MARKET_CATEGORIES), senderAllowlist: new Set(["desk"]), killSwitch: false,
};
const intent: TradeIntent = {
  intentId: "trade-1", instrumentSymbol: symbol, outcome: "yes", notional: usdCents(500),
  source: "desk", senderId: "desk", createdAt: now,
};

function validated(input: PolicyConfig = config) {
  const result = createPolicy(input);
  if (!result.ok) throw new Error("Expected valid policy");
  return result.value;
}

const policy = validated();

describe("price moved guardrail", () => {
  it("refuses only when the live price is more than 2 cents above the price seen", () => {
    const live = { ...market, limitPrice: usdCents(60) };
    expect(evaluate({ ...intent, seenPriceCents: 58 }, live, policy, state, now).kind).toBe("approve");
    expect(evaluate({ ...intent, seenPriceCents: 70 }, live, policy, state, now).kind).toBe("approve");
    expect(evaluate({ ...intent, seenPriceCents: 57 }, live, policy, state, now)).toMatchObject({
      kind: "refuse",
      code: "price-moved",
      spokenReason: "The price moved from 57¢ to 60¢ since you saw it, so I did not place the trade.",
    });
  });

  it("does not apply when the caller saw no price", () => {
    expect(evaluate(intent, { ...market, limitPrice: usdCents(99) }, policy, state, now).kind).toBe("approve");
  });
});

describe("trade policy", () => {
  it("validates ordered, safe cent caps", () => {
    expect(createPolicy(config).ok).toBe(true);
    expect(createPolicy({ ...config, autoApproveMax: usdCents(1001) }).ok).toBe(false);
    expect(createPolicy({ ...config, dailyCap: usdCents(999) }).ok).toBe(false);
    expect(createPolicy({ ...config, dailyCap: usdCents(2 ** 53) }).ok).toBe(false);
  });

  it("requires a validated policy at both decision entry points", () => {
    expectTypeOf<PolicyConfig>().not.toExtend<Parameters<typeof evaluate>[2]>();
    expectTypeOf<PolicyConfig>().not.toExtend<Parameters<typeof confirm>[3]>();
  });

  it("isolates authorization from input and exported set mutations", () => {
    const marketAllowlist = new Set([symbol]);
    const marketCategories = new Set(["Economics"]);
    const senderAllowlist = new Set(["desk"]);
    const isolated = validated({ ...config, marketAllowlist, marketCategories, senderAllowlist });
    const otherSymbol = instrumentSymbol("OTHER");
    marketAllowlist.delete(symbol);
    marketAllowlist.add(otherSymbol);
    marketCategories.add("Sports");
    senderAllowlist.delete("desk");
    senderAllowlist.add("guest");

    expect(isolated.marketAllowlist).toEqual(new Set([symbol]));
    expect(isolated.marketCategories).toEqual(new Set(["Economics"]));
    expect(isolated.senderAllowlist).toEqual(new Set(["desk"]));
    const exportedMarkets = isolated.marketAllowlist as Set<typeof symbol>;
    const exportedSenders = isolated.senderAllowlist as Set<string>;
    exportedMarkets.add(otherSymbol);
    exportedSenders.add("guest");
    const exportedCategories = isolated.marketCategories as Set<string>;
    exportedCategories.add("Sports");
    expect(evaluate(intent, market, isolated, state, now).kind).toBe("approve");
    const unlisted = instrumentSymbol("UNLISTED");
    expect(evaluate({ ...intent, instrumentSymbol: unlisted }, { ...market, instrumentSymbol: unlisted, category: "Sports" }, isolated, state, now))
      .toMatchObject({ code: "market-category-not-allowed" });
    expect(evaluate({ ...intent, senderId: "guest" }, market, isolated, state, now)).toMatchObject({ code: "unauthorized-sender" });
    expect(evaluate({ ...intent, instrumentSymbol: otherSymbol }, { ...market, instrumentSymbol: otherSymbol }, isolated, state, now).kind)
      .toBe("approve");
  });

  it.each([
    ["kill-switch", evaluate({ ...intent, senderId: "guest" }, market, policy.withKillSwitch(true), state, now)],
    ["unauthorized-sender", evaluate({ ...intent, senderId: "guest" }, market, policy, state, now)],
    ["duplicate-intent", evaluate(intent, market, policy, { ...state, seenIntentIds: new Set([intent.intentId]) }, now)],
    ["market-category-not-allowed", evaluate(intent, { ...market, category: "Sports" }, policy, state, now)],
    ["market-closed", evaluate(intent, { ...market, marketState: "closed" }, policy, state, now)],
    ["zero-notional", evaluate({ ...intent, notional: usdCents(0) }, market, policy, state, now)],
    ["over-per-trade-cap", evaluate({ ...intent, notional: usdCents(1001) }, market, policy, state, now)],
    ["over-daily-cap", evaluate(intent, market, policy, { ...state, spentToday: usdCents(1501) }, now)],
  ])("refuses %s", (code, decision) => {
    expect(decision).toMatchObject({ kind: "refuse", code, intentId: intent.intentId });
  });

  it("accepts exact caps and counts reserved funds", () => {
    const used = { ...state, spentToday: usdCents(600), reservedToday: usdCents(400) };
    const atCap = { ...intent, notional: usdCents(1000) };
    expect(evaluate(atCap, market, policy, used, now).kind).toBe("needs-approval");
    expect(evaluate(atCap, market, policy, { ...used, reservedToday: usdCents(401) }, now)).toMatchObject({
      code: "over-daily-cap", spokenReason: "A $10 trade would exceed today's $20 cap, with $9.99 left.",
    });
    expect(evaluate(intent, market, policy, state, now)).toMatchObject({
      kind: "approve", spokenReason: "I approved the $5 trade.",
    });
  });

  it("allows any category by symbol allowlist and matches categories case-insensitively", () => {
    const sports = { ...market, category: "Sports" };
    const byCategory = validated({ ...config, marketCategories: new Set(["sports "]) });
    const bySymbol = validated({ ...config, marketAllowlist: new Set([symbol]), marketCategories: new Set() });
    expect(evaluate(intent, sports, byCategory, state, now).kind).toBe("approve");
    expect(evaluate(intent, sports, bySymbol, state, now).kind).toBe("approve");
    expect(evaluate(intent, sports, policy, state, now)).toMatchObject({
      code: "market-category-not-allowed", spokenReason: "Sports markets are outside the desk's news-trading policy.",
    });
  });

  it("explains category refusals for cards", () => {
    expect(marketPolicyRefusal(policy, symbol, "Weather")).toBe("Weather markets are outside the desk's news-trading policy.");
    expect(marketPolicyRefusal(policy, symbol, "Politics")).toBeUndefined();
  });

  it("requires an allowlisted approver one cent above the threshold", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, policy, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    expect(confirm(pending, "guest", market, policy, state, now)).toMatchObject({ kind: "refuse", code: "unauthorized-sender" });
    expect(confirm(pending, "desk", market, policy.withKillSwitch(true), state, now)).toMatchObject({ kind: "refuse", code: "kill-switch" });
    expect(confirm(pending, "desk", market, policy, state, now)).toMatchObject({ kind: "approve", notional: 501 });
  });

  it("re-checks the daily cap when a pending trade is confirmed later", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, policy, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    const afterOtherSpend = { ...state, spentToday: usdCents(1600) };
    expect(confirm(pending, "desk", market, policy, afterOtherSpend, now)).toMatchObject({
      kind: "refuse", code: "over-daily-cap", intentId: intent.intentId,
    });
    const nextDay = new Date("2026-11-18T00:00:00Z");
    expect(confirm(pending, "desk", market, policy, afterOtherSpend, nextDay)).toMatchObject({ kind: "approve" });
  });

  it("refuses to confirm the same intent twice", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, policy, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    const first = confirm(pending, "desk", market, policy, state, now);
    if (first.kind !== "approve") throw new Error("Expected approval");
    const afterFirst = applyApproved(state, first);
    expect(confirm(pending, "desk", market, policy, afterFirst, now)).toMatchObject({ kind: "refuse", code: "duplicate-intent" });
  });

  it("re-checks the per-trade cap and market allowlist on confirm", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, policy, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    expect(confirm(pending, "desk", market, validated({ ...config, perTradeMax: usdCents(500) }), state, now)).toMatchObject({ code: "over-per-trade-cap" });
    expect(confirm(pending, "desk", market, validated({ ...config, marketCategories: new Set() }), state, now)).toMatchObject({ code: "market-category-not-allowed" });
  });

  it("resets UTC spend while retaining reservations and replay protection", () => {
    const approved = evaluate(intent, market, policy, state, now);
    if (approved.kind !== "approve") throw new Error("Expected approval");
    const updated = applyApproved(state, approved);
    expect(updated.spentToday).toBe(500);
    expect(state.spentToday).toBe(0);
    expect(applyApproved(updated, approved)).toBe(updated);
    const midnight = new Date("2026-11-18T00:00:00Z");
    expect(rollDay({ ...updated, reservedToday: usdCents(400) }, midnight)).toEqual({
      day: "2026-11-18", spentToday: 0, reservedToday: 400, seenIntentIds: new Set([intent.intentId]),
    });
    expect(evaluate(intent, market, policy, updated, midnight)).toMatchObject({ code: "duplicate-intent" });
  });

  it("still refuses confirmations over the remaining budget when the UTC day rolls over", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, policy, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    const reserved = { ...state, reservedToday: usdCents(config.dailyCap) };
    const midnight = new Date("2026-11-18T00:00:00Z");
    expect(confirm(pending, "desk", market, policy, reserved, midnight)).toMatchObject({ code: "over-daily-cap" });
  });

  it("keeps sequential approvals within the daily cap for varied intent sequences", () => {
    let seed = 192;
    for (let sequence = 0; sequence < 20; sequence++) {
      let current = state;
      for (let index = 0; index < 50; index++) {
        seed = (seed * 16807) % 2147483647;
        const decision = evaluate({ ...intent, intentId: String(index), notional: usdCents(seed % 1200) }, market, policy, current, now);
        const approved = decision.kind === "needs-approval" ? confirm(decision, "desk", market, policy, current, now) : decision;
        if (approved.kind === "approve") current = applyApproved(current, approved);
        expect(current.spentToday).toBeLessThanOrEqual(config.dailyCap);
      }
    }
  });
});

describe("research spend", () => {
  const research = validated({ ...config, autoApproveMax: usdCents(200) });
  const spend = { spendId: "research:n1", notional: usdCents(5) };

  it("approves a spend under every limit", () => {
    expect(evaluateResearch(spend, research, state, now)).toMatchObject({ kind: "approve", intentId: "research:n1", notional: 5 });
  });

  it.each([
    ["kill switch", research.withKillSwitch(true), spend, state, "kill-switch", "Trading is paused, so I did not buy research."],
    ["zero price", research, { ...spend, notional: usdCents(0) }, state, "zero-notional", "The research price must be greater than $0."],
    ["per-trade cap", validated({ ...config, perTradeMax: usdCents(300), autoApproveMax: usdCents(2) }), { ...spend, notional: usdCents(400) }, state, "over-per-trade-cap", "A $4 research purchase exceeds the $3 limit per trade."],
    ["auto-approve limit", research, { ...spend, notional: usdCents(300) }, state, "over-auto-approve-max", "A $3 research purchase is above the $2 I can approve on my own."],
    ["daily cap", research, spend, { ...state, spentToday: usdCents(1998) }, "over-daily-cap", "A $0.05 research purchase would exceed today's $20 budget, with $0.02 left."],
    ["reserved budget", research, spend, { ...state, spentToday: usdCents(1990), reservedToday: usdCents(8) }, "over-daily-cap", "A $0.05 research purchase would exceed today's $20 budget, with $0.02 left."],
    ["duplicate", research, spend, { ...state, seenIntentIds: new Set(["research:n1"]) }, "duplicate-intent", "I've already approved this research purchase."],
  ] as const)("refuses on %s with a spoken reason", (_name, testPolicy, testSpend, testState, code, spokenReason) => {
    expect(evaluateResearch(testSpend, testPolicy, testState, now)).toEqual({ kind: "refuse", spendId: testSpend.spendId, code, spokenReason });
  });

  it("shares the daily budget with bets: a research spend lowers what a trade can use", () => {
    const approved = evaluateResearch(spend, research, state, now);
    if (approved.kind !== "approve") throw new Error("expected approval");
    const spent = applyApproved(state, approved);
    expect(spent.spentToday).toBe(5);
    expect(remainingBudget(research, spent, now)).toBe(1995);
  });
});

describe("deriving the daily budget from the spend journal", () => {
  const spends = [
    { operationId: "a", status: "settled", notionalCents: 200, resolvedAt: "2026-11-17T10:00:00.000Z" },
    { operationId: "b", status: "settled", notionalCents: 5, resolvedAt: "2026-11-17T11:00:00.000Z" },
    { operationId: "c", status: "failed", notionalCents: 900, resolvedAt: "2026-11-17T11:30:00.000Z" },
    { operationId: "d", status: "reserved", notionalCents: 600 },
    { operationId: "e", status: "settled", notionalCents: 1000, resolvedAt: "2026-11-16T23:59:59.000Z" },
  ] as const;

  it("sums today's settled spend and every unresolved reservation, and remembers every operation id", () => {
    const state = policyStateFromSpends(spends, now);
    expect(state).toMatchObject({ day: "2026-11-17", spentToday: 205, reservedToday: 600 });
    expect([...state.seenIntentIds].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps an unresolved reservation counted across the UTC midnight rollover while yesterday's settled spend drops out", () => {
    const state = policyStateFromSpends(spends, new Date("2026-11-18T00:00:00Z"));
    expect(state).toMatchObject({ day: "2026-11-18", spentToday: 0, reservedToday: 600 });
  });
});
