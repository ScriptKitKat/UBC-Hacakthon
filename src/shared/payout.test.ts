import { describe, expect, it } from "vitest";
import { payoutFor } from "./payout";
import type { PayoutQuote } from "./payout";

function quote(priceCents: number, stakeCents: number): PayoutQuote {
  const result = payoutFor(priceCents, stakeCents);
  if (result.kind !== "quote") throw new Error(`expected a quote, got ${result.kind}`);
  return result;
}

describe("payoutFor", () => {
  it("pays $1 per contract: 62¢ for $1 buys 1.61 contracts", () => {
    const result = quote(62, 100);
    expect(result.contracts).toBe(1.61);
    expect(result.payoutCents).toBe(161);
    expect(result.profitCents).toBe(61);
    expect(result.returnPercent).toBeCloseTo(61, 5);
    expect(result.breakEvenPercent).toBe(62);
  });

  it("matches the desk's quantity rounding down to hundredths of a contract", () => {
    const result = quote(33, 100);
    expect(result.contracts).toBe(3.03);
    expect(result.payoutCents).toBe(303);
  });

  it("uses the real price of whichever side is bought", () => {
    const yes = quote(62, 500);
    const no = quote(40, 500);
    expect(yes.payoutCents).toBe(806);
    expect(no.payoutCents).toBe(1250);
    expect(no.profitCents).toBe(750);
  });

  it("returns exactly the stake back at a 100¢ price", () => {
    const result = quote(100, 250);
    expect(result.contracts).toBe(2.5);
    expect(result.profitCents).toBe(0);
    expect(result.returnPercent).toBe(0);
  });

  it("handles 1¢ prices without overflow", () => {
    const result = quote(1, 100);
    expect(result.contracts).toBe(100);
    expect(result.payoutCents).toBe(10_000);
    expect(result.returnPercent).toBeCloseTo(9900, 5);
  });

  it("never rounds a payout up past what the stake buys", () => {
    for (const price of [3, 7, 13, 29, 41, 59, 73, 97]) {
      const result = quote(price, 100);
      expect((result.contracts * price) / 100).toBeLessThanOrEqual(1);
    }
  });

  it("says there is no price instead of guessing one", () => {
    expect(payoutFor(null, 100)).toEqual({ kind: "no-price" });
    expect(payoutFor(0, 100)).toEqual({ kind: "no-price" });
    expect(payoutFor(101, 100)).toEqual({ kind: "no-price" });
    expect(payoutFor(Number.NaN, 100)).toEqual({ kind: "no-price" });
  });

  it("rejects stakes that are not positive whole cents", () => {
    expect(payoutFor(62, 0)).toEqual({ kind: "invalid-stake" });
    expect(payoutFor(62, -5)).toEqual({ kind: "invalid-stake" });
    expect(payoutFor(62, 1.5)).toEqual({ kind: "invalid-stake" });
    expect(payoutFor(62, Number.NaN)).toEqual({ kind: "invalid-stake" });
  });

  it("buys a hundredth of a contract with the smallest stake", () => {
    expect(payoutFor(100, 1)).toMatchObject({ kind: "quote", contracts: 0.01 });
  });
});
