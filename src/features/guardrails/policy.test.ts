import { describe, expect, it } from "vitest";
import { instrumentSymbol, usdCents } from "@/shared";
import type { TradeIntent } from "@/shared";
import { applyApproved, confirm, createPolicy, evaluate, rollDay } from "./index";
import type { PolicyConfig, PolicyState } from "./index";

const now = new Date("2026-11-17T23:59:59Z");
const symbol = instrumentSymbol("RATE-DEC");
const market = { instrumentSymbol: symbol, marketState: "open", status: "approved" };
const state: PolicyState = {
  day: "2026-11-17", spentToday: usdCents(0), reservedToday: usdCents(0), seenIntentIds: new Set(),
};
const config: PolicyConfig = {
  dailyCap: usdCents(2000), perTradeMax: usdCents(1000), autoApproveMax: usdCents(500),
  marketAllowlist: new Set([symbol]), senderAllowlist: new Set(["desk"]), killSwitch: false,
};
const intent: TradeIntent = {
  intentId: "trade-1", instrumentSymbol: symbol, outcome: "yes", notional: usdCents(500),
  source: "desk", senderId: "desk", createdAt: now,
};

describe("trade policy", () => {
  it("validates ordered, safe cent caps", () => {
    expect(createPolicy(config).ok).toBe(true);
    expect(createPolicy({ ...config, autoApproveMax: usdCents(1001) }).ok).toBe(false);
    expect(createPolicy({ ...config, dailyCap: usdCents(999) }).ok).toBe(false);
    expect(createPolicy({ ...config, dailyCap: usdCents(2 ** 53) }).ok).toBe(false);
  });

  it.each([
    ["kill-switch", evaluate({ ...intent, senderId: "guest" }, market, { ...config, killSwitch: true }, state, now)],
    ["unauthorized-sender", evaluate({ ...intent, senderId: "guest" }, market, config, state, now)],
    ["duplicate-intent", evaluate(intent, market, config, { ...state, seenIntentIds: new Set([intent.intentId]) }, now)],
    ["market-not-allowlisted", evaluate(intent, market, { ...config, marketAllowlist: new Set() }, state, now)],
    ["market-closed", evaluate(intent, { ...market, marketState: "closed" }, config, state, now)],
    ["zero-notional", evaluate({ ...intent, notional: usdCents(0) }, market, config, state, now)],
    ["over-per-trade-cap", evaluate({ ...intent, notional: usdCents(1001) }, market, config, state, now)],
    ["over-daily-cap", evaluate(intent, market, config, { ...state, spentToday: usdCents(1501) }, now)],
  ])("refuses %s", (code, decision) => {
    expect(decision).toMatchObject({ kind: "refuse", code, intentId: intent.intentId });
  });

  it("accepts exact caps and counts reserved funds", () => {
    const used = { ...state, spentToday: usdCents(600), reservedToday: usdCents(400) };
    const atCap = { ...intent, notional: usdCents(1000) };
    expect(evaluate(atCap, market, config, used, now).kind).toBe("needs-approval");
    expect(evaluate(atCap, market, config, { ...used, reservedToday: usdCents(401) }, now)).toMatchObject({
      code: "over-daily-cap", spokenReason: "A $10 trade would exceed today's $20 cap, with $9.99 left.",
    });
    expect(evaluate(intent, market, config, state, now)).toMatchObject({
      kind: "approve", spokenReason: "I approved the $5 trade.",
    });
  });

  it("requires an allowlisted approver one cent above the threshold", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, config, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    expect(confirm(pending, "guest", config, state, now)).toMatchObject({ kind: "refuse", code: "unauthorized-sender" });
    expect(confirm(pending, "desk", { ...config, killSwitch: true }, state, now)).toMatchObject({ kind: "refuse", code: "kill-switch" });
    expect(confirm(pending, "desk", config, state, now)).toMatchObject({ kind: "approve", notional: 501 });
  });

  it("re-checks the daily cap when a pending trade is confirmed later", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, config, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    const afterOtherSpend = { ...state, spentToday: usdCents(1600) };
    expect(confirm(pending, "desk", config, afterOtherSpend, now)).toMatchObject({
      kind: "refuse", code: "over-daily-cap", intentId: intent.intentId,
    });
    const nextDay = new Date("2026-11-18T00:00:00Z");
    expect(confirm(pending, "desk", config, afterOtherSpend, nextDay)).toMatchObject({ kind: "approve" });
  });

  it("refuses to confirm the same intent twice", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, config, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    const first = confirm(pending, "desk", config, state, now);
    if (first.kind !== "approve") throw new Error("Expected approval");
    const afterFirst = applyApproved(state, first);
    expect(confirm(pending, "desk", config, afterFirst, now)).toMatchObject({ kind: "refuse", code: "duplicate-intent" });
  });

  it("re-checks the per-trade cap and market allowlist on confirm", () => {
    const pending = evaluate({ ...intent, notional: usdCents(501) }, market, config, state, now);
    if (pending.kind !== "needs-approval") throw new Error("Expected pending decision");
    expect(confirm(pending, "desk", { ...config, perTradeMax: usdCents(500) }, state, now)).toMatchObject({ code: "over-per-trade-cap" });
    expect(confirm(pending, "desk", { ...config, marketAllowlist: new Set() }, state, now)).toMatchObject({ code: "market-not-allowlisted" });
  });

  it("rolls UTC spend and reservations over while retaining replay protection", () => {
    const approved = evaluate(intent, market, config, state, now);
    if (approved.kind !== "approve") throw new Error("Expected approval");
    const updated = applyApproved(state, approved);
    expect(updated.spentToday).toBe(500);
    expect(state.spentToday).toBe(0);
    expect(applyApproved(updated, approved)).toBe(updated);
    const midnight = new Date("2026-11-18T00:00:00Z");
    expect(rollDay({ ...updated, reservedToday: usdCents(400) }, midnight)).toEqual({
      day: "2026-11-18", spentToday: 0, reservedToday: 0, seenIntentIds: new Set([intent.intentId]),
    });
    expect(evaluate(intent, market, config, updated, midnight)).toMatchObject({ code: "duplicate-intent" });
  });

  it("keeps sequential approvals within the daily cap for varied intent sequences", () => {
    let seed = 192;
    for (let sequence = 0; sequence < 20; sequence++) {
      let current = state;
      for (let index = 0; index < 50; index++) {
        seed = (seed * 16807) % 2147483647;
        const decision = evaluate({ ...intent, intentId: String(index), notional: usdCents(seed % 1200) }, market, config, current, now);
        const approved = decision.kind === "needs-approval" ? confirm(decision, "desk", config, current, now) : decision;
        if (approved.kind === "approve") current = applyApproved(current, approved);
        expect(current.spentToday).toBeLessThanOrEqual(config.dailyCap);
      }
    }
  });
});
