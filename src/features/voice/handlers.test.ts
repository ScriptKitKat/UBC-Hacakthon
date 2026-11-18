import { describe, expect, it } from "vitest";
import { runVoiceTool } from "./handlers";
import { FED_HEADLINE, fixtureWithMatchedNews, voiceFixture } from "./test-desk";

describe("get_market_quote", () => {
  it("reads the matched market, odds, news and budget", async () => {
    const { deps } = await fixtureWithMatchedNews();
    const result = await runVoiceTool(deps, "get_market_quote", {});
    expect(result).toMatchObject({
      status: "quote",
      market: { title: "Fed decision in December?", contract: "Fed maintains rate", yesCents: 62, noCents: 40 },
      news: { headline: FED_HEADLINE },
      budgetRemainingUsd: 20,
    });
    expect(result.say).toContain("Yes is 62 cents and no is 40 cents");
    expect(result.say).toContain(FED_HEADLINE);
    expect(result.say).toContain("20 dollars left");
  });

  it("says plainly that nothing matched when no news was submitted", async () => {
    const { deps } = voiceFixture();
    const result = await runVoiceTool(deps, "get_market_quote", {});
    expect(result.status).toBe("no-match");
    expect(result.say).toContain("No market is matched");
  });
});

describe("propose_trade", () => {
  it("auto-approves a small trade, debits the ledger and returns the paper ticket", async () => {
    const { deps, debit } = await fixtureWithMatchedNews();
    const result = await runVoiceTool(deps, "propose_trade", { outcome: "yes", amount_usd: 1 });
    expect(debit).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "placed", side: "yes", amountUsd: 1, ticketId: expect.any(String) as unknown });
    const status = await runVoiceTool(deps, "get_desk_status", {});
    expect(status).toMatchObject({ status: "desk-status", spentUsd: 1, remainingUsd: 19 });
    expect(status.say).toContain("spent 1 dollar today and have 19 dollars left");
  });

  it("holds a larger trade for approval, then approves the most recent pending trade", async () => {
    const { deps, debit } = await fixtureWithMatchedNews();
    const proposed = await runVoiceTool(deps, "propose_trade", { outcome: "no", amount_usd: 5 });
    expect(proposed).toMatchObject({ status: "needs-approval", side: "no", amountUsd: 5 });
    expect(debit).not.toHaveBeenCalled();
    expect(await runVoiceTool(deps, "get_desk_status", {})).toMatchObject({ pending: [{ side: "no", amountUsd: 5 }] });
    const approved = await runVoiceTool(deps, "approve_pending_trade", {});
    expect(approved).toMatchObject({ status: "placed", side: "no", amountUsd: 5 });
    expect(debit).toHaveBeenCalledOnce();
    expect(await runVoiceTool(deps, "approve_pending_trade", {})).toMatchObject({ status: "nothing-pending" });
  });

  it("approves a pending trade by explicit id and reports unknown ids", async () => {
    const { deps } = await fixtureWithMatchedNews();
    const proposed = await runVoiceTool(deps, "propose_trade", { outcome: "yes", amount_usd: 5 });
    if (proposed.status !== "needs-approval") throw new Error("expected needs-approval");
    expect(await runVoiceTool(deps, "approve_pending_trade", { intent_id: "missing" })).toMatchObject({ status: "unknown-intent" });
    expect(await runVoiceTool(deps, "approve_pending_trade", { intent_id: proposed.intentId })).toMatchObject({ status: "placed" });
  });

  it("speaks the guardrail's reason verbatim when a trade exceeds the per-trade max", async () => {
    const { deps, desk, debit } = await fixtureWithMatchedNews();
    const result = await runVoiceTool(deps, "propose_trade", { outcome: "yes", amount_usd: 50 });
    const [entry] = (await desk.getSnapshot()).log;
    expect(result).toMatchObject({ status: "refused", code: "over-per-trade-cap" });
    expect(result.say).toBe(entry?.spokenReason);
    expect(result.say).toContain("exceeds");
    expect(debit).not.toHaveBeenCalled();
  });

  it("speaks the kill switch reason verbatim", async () => {
    const { deps, desk } = await fixtureWithMatchedNews();
    desk.setKillSwitch(true);
    const result = await runVoiceTool(deps, "propose_trade", { outcome: "yes", amount_usd: 1 });
    const [entry] = (await desk.getSnapshot()).log;
    expect(result).toMatchObject({ status: "refused", code: "kill-switch" });
    expect(result.say).toBe(entry?.spokenReason);
    expect(await runVoiceTool(deps, "get_desk_status", {})).toMatchObject({ killSwitch: true });
  });

  it("refuses when the operator is not in the sender allowlist", async () => {
    const { deps, debit } = await fixtureWithMatchedNews({ senders: ["someone-else"] });
    const result = await runVoiceTool(deps, "propose_trade", { outcome: "yes", amount_usd: 1 });
    expect(result).toMatchObject({ status: "refused", code: "unauthorized-sender" });
    expect(debit).not.toHaveBeenCalled();
  });

  it("does not trade when no market is matched", async () => {
    const { deps, debit } = voiceFixture();
    expect(await runVoiceTool(deps, "propose_trade", { outcome: "yes", amount_usd: 1 })).toMatchObject({ status: "no-match" });
    expect(debit).not.toHaveBeenCalled();
  });

  it.each([
    ["negative", { outcome: "yes", amount_usd: -2 }],
    ["zero", { outcome: "yes", amount_usd: 0 }],
    ["fractional cents", { outcome: "yes", amount_usd: 1.005 }],
    ["NaN", { outcome: "yes", amount_usd: Number.NaN }],
    ["a string", { outcome: "yes", amount_usd: "two" }],
    ["missing", { outcome: "yes" }],
    ["bad outcome", { outcome: "maybe", amount_usd: 1 }],
    ["not an object", "yes please"],
  ])("rejects %s without touching the desk", async (_name, parameters) => {
    const { deps, debit, desk } = await fixtureWithMatchedNews();
    const result = await runVoiceTool(deps, "propose_trade", parameters);
    expect(result.status).toBe("invalid-request");
    expect(debit).not.toHaveBeenCalled();
    expect((await desk.getSnapshot()).log).toEqual([]);
  });
});
