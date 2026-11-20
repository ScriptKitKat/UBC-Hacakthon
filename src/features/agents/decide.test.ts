import { describe, expect, it } from "vitest";
import { clampDecision, ruleDecision } from "./decide";

describe("clampDecision", () => {
  it("skips invalid or missing decisions and bets without a side", () => {
    expect(clampDecision(undefined, 200)).toMatchObject({ action: "skip" });
    expect(clampDecision({ action: "wait" }, 200)).toMatchObject({ action: "skip" });
    expect(clampDecision({ action: "bet" }, 200)).toMatchObject({ action: "skip" });
    expect(clampDecision({ action: "bet", side: "yes" }, 0)).toMatchObject({ action: "skip" });
  });

  it("rounds and clamps amounts and defaults a missing amount to the cap", () => {
    expect(clampDecision({ action: "bet", side: "no", amountUsd: 1.237, reason: "test" }, 500)).toMatchObject({ action: "bet", side: "no", amountCents: 124, reason: "test" });
    expect(clampDecision({ action: "bet", side: "yes", amountUsd: 20 }, 200).amountCents).toBe(200);
    expect(clampDecision({ action: "bet", side: "yes", amountUsd: 0 }, 200).amountCents).toBe(1);
    expect(clampDecision({ action: "bet", side: "yes" }, 200).amountCents).toBe(200);
  });
});

describe("ruleDecision", () => {
  it("uses the price direction or skips without movement", () => {
    expect(ruleDecision(8, 200)).toMatchObject({ action: "bet", side: "yes", amountCents: 200 });
    expect(ruleDecision(-8, 200)).toMatchObject({ action: "bet", side: "no", amountCents: 200 });
    expect(ruleDecision(0, 200)).toMatchObject({ action: "skip", reason: "price hasn't moved" });
  });
});
