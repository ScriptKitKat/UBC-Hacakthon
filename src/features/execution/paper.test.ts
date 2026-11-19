import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createPolicy, evaluate } from "@/features/guardrails";
import type { ApprovedTrade, Decision } from "@/features/guardrails";
import type { UsdcLedger } from "@/features/ledger";
import { instrumentSymbol, usdCents } from "@/shared";
import { buildGeminiOrderPayload, executeApproved } from "./index";
import type { PaperOrderTicket, TRADING_MODE } from "./index";

const now = new Date("2026-11-18T00:00:00Z");
const symbol = instrumentSymbol("RATE-DEC");
const policy = createPolicy({
  dailyCap: usdCents(2000), perTradeMax: usdCents(500), autoApproveMax: usdCents(200),
  marketAllowlist: new Set([symbol]), marketCategories: new Set(["Economics"]), senderAllowlist: new Set(["desk"]), killSwitch: false,
});
if (!policy.ok) throw new Error("Expected a valid policy");
const decision = evaluate(
  { intentId: "trade-2", instrumentSymbol: symbol, outcome: "no", notional: usdCents(200), source: "desk", senderId: "desk", createdAt: now },
  { instrumentSymbol: symbol, marketState: "open", status: "active", eventStatus: "active", category: "Economics", limitPrice: usdCents(50) },
  policy.value,
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
    const limits = { quantityIncrementHundredths: 50n, quantityMinimumHundredths: 100n, priceIncrementCents: 5n, priceMinimumCents: 5n };
    expect(buildGeminiOrderPayload(approved, usdCents(65), { limits })).toMatchObject({
      ok: true, value: { quantity: "3.00", price: "0.65" },
    });
    expect(buildGeminiOrderPayload(approved, usdCents(67), { limits })).toEqual({ ok: false, error: { code: "invalid-limit-price" } });
    expect(buildGeminiOrderPayload(approved, usdCents(100), { limits: { ...limits, quantityMinimumHundredths: 300n } })).toEqual({
      ok: false, error: { code: "quantity-below-minimum" },
    });
  });

  const reserve = () => vi.fn<(ticket: PaperOrderTicket) => Promise<boolean>>().mockResolvedValue(true);
  const beforeBroadcast = () => Promise.resolve(true);

  it("reserves the order durably before debiting and only reports an order once the debit succeeded", async () => {
    const debit = vi.fn<UsdcLedger["debit"]>().mockResolvedValue({ ok: true, value: receipt });
    const reserveOrder = reserve();
    const execution = executeApproved(approved, { ledger: { debit }, idGen: () => "paper-2", now: () => now, limitPrice: usdCents(67), reserve: reserveOrder, beforeBroadcast });
    expect(reserveOrder).toHaveBeenCalledOnce();
    expect(debit).not.toHaveBeenCalled();
    const record = await execution;
    expect(reserveOrder).toHaveBeenCalledBefore(debit);
    expect(debit).toHaveBeenCalledExactlyOnceWith("trade-2", 200, "trade-2|RATE-DEC|no|200", beforeBroadcast);
    expect(record).toEqual({
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
    expect(reserveOrder.mock.calls[0]?.[0]).toBe(record.kind === "paper-order" ? record.ticket : undefined);
  });

  it("never debits when the reservation could not be recorded", async () => {
    const debit = vi.fn<UsdcLedger["debit"]>();
    const record = await executeApproved(approved, {
      ledger: { debit }, idGen: () => "paper-2", now: () => now, limitPrice: usdCents(67), reserve: () => Promise.resolve(false), beforeBroadcast,
    });
    expect(record).toMatchObject({ kind: "execution-failed", error: { code: "journal-unavailable" } });
    expect(debit).not.toHaveBeenCalled();
  });

  it("records a ledger failure without returning a ticket", async () => {
    const error = { code: "debit-unconfirmed", signature: "signature" } as const;
    const debit = vi.fn<UsdcLedger["debit"]>().mockResolvedValue({ ok: false, error });
    const record = await executeApproved(approved, { ledger: { debit }, idGen: () => "paper-2", now: () => now, limitPrice: usdCents(67), reserve: reserve(), beforeBroadcast });
    expect(record).toMatchObject({ kind: "execution-failed", intentId: "trade-2", error });
    expect(record).not.toHaveProperty("ticket");
  });

  it("refuses a ticket below the quantity minimum before debiting", async () => {
    const debit = vi.fn<UsdcLedger["debit"]>();
    const limits = { quantityIncrementHundredths: 1n, quantityMinimumHundredths: 500n, priceIncrementCents: 1n, priceMinimumCents: 1n };
    const record = await executeApproved(approved, { ledger: { debit }, idGen: () => "paper-2", now: () => now, limitPrice: usdCents(67), limits, reserve: reserve(), beforeBroadcast });
    expect(record).toMatchObject({ kind: "execution-failed", error: { code: "quantity-below-minimum" } });
    expect(debit).not.toHaveBeenCalled();
  });

  it.each([0, 101])("rejects a %d-cent limit price before debiting", async (price) => {
    const debit = vi.fn<UsdcLedger["debit"]>();
    const record = await executeApproved(approved, { ledger: { debit }, idGen: () => "paper-2", now: () => now, limitPrice: usdCents(price), reserve: reserve(), beforeBroadcast });
    expect(record).toMatchObject({ kind: "execution-failed", error: { code: "invalid-limit-price" } });
    expect(debit).not.toHaveBeenCalled();
  });
});
