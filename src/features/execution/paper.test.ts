import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { evaluate } from "@/features/guardrails";
import type { ApprovedTrade, Decision } from "@/features/guardrails";
import type { UsdcLedger } from "@/features/ledger";
import { instrumentSymbol, usdCents } from "@/shared";
import { buildGeminiOrderPayload, executeApproved } from "./index";
import type { TRADING_MODE } from "./index";

const now = new Date("2026-11-18T00:00:00Z");
const symbol = instrumentSymbol("RATE-DEC");
const decision = evaluate(
  { intentId: "trade-2", instrumentSymbol: symbol, outcome: "no", notional: usdCents(200), source: "desk", senderId: "desk", createdAt: now },
  { instrumentSymbol: symbol, marketState: "open", status: "active", eventStatus: "active", limitPrice: usdCents(50) },
  { dailyCap: usdCents(2000), perTradeMax: usdCents(500), autoApproveMax: usdCents(200),
    marketAllowlist: new Set([symbol]), senderAllowlist: new Set(["desk"]), killSwitch: false },
  { day: "2026-11-18", spentToday: usdCents(0), reservedToday: usdCents(0), seenIntentIds: new Set() },
  now,
);
if (decision.kind !== "approve") throw new Error("Expected an approved fixture");
const approved = decision;
const receipt = { signature: "signature", explorerUrl: "https://explorer.solana.com/tx/signature?cluster=devnet" };

describe("paper execution", () => {
  it("accepts only opaque approvals and exposes only paper mode", () => {
    expectTypeOf<Parameters<typeof executeApproved>[0]>().toEqualTypeOf<ApprovedTrade>();
    expectTypeOf<Exclude<Decision, ApprovedTrade>>().not.toExtend<ApprovedTrade>();
    expectTypeOf<Pick<ApprovedTrade, keyof ApprovedTrade>>().not.toExtend<ApprovedTrade>();
    expectTypeOf<TRADING_MODE>().toEqualTypeOf<"paper">();
  });

  it("uses quantity increments without rounding above the budget", () => {
    expect(buildGeminiOrderPayload(approved, usdCents(67), { timeInForce: "fill-or-kill" })).toEqual({
      ok: true,
      value: { symbol, orderType: "limit", side: "buy", quantity: "2.98", price: "0.67", outcome: "no", timeInForce: "fill-or-kill" },
    });
    expect(buildGeminiOrderPayload(approved, usdCents(100))).toMatchObject({ ok: true, value: { quantity: "2.00", price: "1.00" } });
    expect(buildGeminiOrderPayload(approved, usdCents(1))).toMatchObject({ ok: true, value: { quantity: "200.00", price: "0.01" } });
  });

  it("omits fields that are not part of Gemini's order schema", () => {
    const built = buildGeminiOrderPayload(approved, usdCents(67));
    if (!built.ok) throw new Error("Expected payload");
    expect(Object.keys(built.value).sort()).toEqual(["orderType", "outcome", "price", "quantity", "side", "symbol", "timeInForce"]);
  });

  it("applies the contract's quantity and price limits", () => {
    const limits = { quantityIncrement: "0.5", quantityMinimum: "1", priceIncrement: "0.05", priceMinimum: "0.05" };
    expect(buildGeminiOrderPayload(approved, usdCents(65), { limits })).toMatchObject({
      ok: true, value: { quantity: "3.00", price: "0.65" },
    });
    expect(buildGeminiOrderPayload(approved, usdCents(67), { limits })).toEqual({ ok: false, error: { code: "invalid-limit-price" } });
    expect(buildGeminiOrderPayload(approved, usdCents(100), { limits: { ...limits, quantityMinimum: "3" } })).toEqual({
      ok: false, error: { code: "quantity-below-minimum" },
    });
  });

  it("awaits the debit before creating the ticket", async () => {
    const debit = vi.fn<UsdcLedger["debit"]>().mockResolvedValue({ ok: true, value: receipt });
    const idGen = vi.fn(() => "paper-2");
    const clock = vi.fn(() => now);
    const execution = executeApproved(approved, { ledger: { debit }, idGen, now: clock, limitPrice: usdCents(67) });
    expect(debit).toHaveBeenCalledExactlyOnceWith("trade-2", 200, "trade-2|RATE-DEC|no|200");
    expect(idGen).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(await execution).toEqual({
      kind: "paper-order",
      intentId: "trade-2",
      instrumentSymbol: symbol,
      outcome: "no",
      notional: 200,
      spokenReason: "I approved the $2 trade.",
      debit: receipt,
      ticket: {
        ticketId: "paper-2", mode: "paper", createdAt: now, payload: {
          symbol, orderType: "limit", side: "buy", quantity: "2.98", price: "0.67", outcome: "no", timeInForce: "good-til-cancel",
        },
      },
    });
  });

  it("records a ledger failure without creating a ticket", async () => {
    const error = { code: "debit-unconfirmed", signature: "signature" } as const;
    const debit = vi.fn<UsdcLedger["debit"]>().mockResolvedValue({ ok: false, error });
    const idGen = vi.fn();
    const record = await executeApproved(approved, { ledger: { debit }, idGen, now: () => now, limitPrice: usdCents(67) });
    expect(record).toMatchObject({ kind: "execution-failed", intentId: "trade-2", error });
    expect(record).not.toHaveProperty("ticket");
    expect(idGen).not.toHaveBeenCalled();
  });

  it("refuses a ticket below the quantity minimum before debiting", async () => {
    const debit = vi.fn<UsdcLedger["debit"]>();
    const limits = { quantityIncrement: "0.01", quantityMinimum: "5", priceIncrement: "0.01", priceMinimum: "0.01" };
    const record = await executeApproved(approved, { ledger: { debit }, idGen: () => "paper-2", now: () => now, limitPrice: usdCents(67), limits });
    expect(record).toMatchObject({ kind: "execution-failed", error: { code: "quantity-below-minimum" } });
    expect(debit).not.toHaveBeenCalled();
  });

  it.each([0, 101])("rejects a %d-cent limit price before debiting", async (price) => {
    const debit = vi.fn<UsdcLedger["debit"]>();
    const record = await executeApproved(approved, { ledger: { debit }, idGen: () => "paper-2", now: () => now, limitPrice: usdCents(price) });
    expect(record).toMatchObject({ kind: "execution-failed", error: { code: "invalid-limit-price" } });
    expect(debit).not.toHaveBeenCalled();
  });
});
