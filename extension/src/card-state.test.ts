import { describe, expect, it } from "vitest";
import { canBuy, cardReducer, initialCardState, statusFromEntry } from "./card-state";
import { entry, market, matched, quote } from "./fixtures";

const start = initialCardState(matched);

describe("card state machine", () => {
  it("starts idle with a $1 default", () => {
    expect(start).toMatchObject({ amountText: "1.00", status: { phase: "idle" } });
    expect(canBuy(start)).toBe(true);
  });

  it("ignores buys on markets the policy blocks", () => {
    const blocked = initialCardState({ ...matched, market: { ...market, tradeable: false } });
    expect(cardReducer(blocked, { type: "buy-started" })).toBe(blocked);
  });

  it("prevents double submits while buying and ignores stray results", () => {
    const buying = cardReducer(start, { type: "buy-started" });
    expect(buying.status.phase).toBe("buying");
    expect(cardReducer(buying, { type: "buy-started" })).toBe(buying);
    expect(cardReducer(buying, { type: "amount-edited", amountText: "5" })).toBe(buying);
    expect(cardReducer(start, { type: "buy-settled", entry: entry() })).toBe(start);
  });

  it.each([
    ["approve", "filled"],
    ["needs-approval", "needs-approval"],
    ["refuse", "refused"],
    ["execution-failed", "refused"],
  ] as const)("maps %s entries to %s", (kind, phase) => {
    const settled = cardReducer(cardReducer(start, { type: "buy-started" }), { type: "buy-settled", entry: entry({ kind }) });
    expect(settled.status.phase).toBe(phase);
    expect(statusFromEntry(entry({ kind })).phase).toBe(phase);
  });

  it("shows a quiet error when the desk fails", () => {
    const failed = cardReducer(cardReducer(start, { type: "buy-started" }), { type: "buy-failed", message: "Can't reach the desk." });
    expect(failed.status).toEqual({ phase: "error", message: "Can't reach the desk." });
    expect(canBuy(failed)).toBe(true);
  });

  it("walks the approval flow and keeps the intent on failure", () => {
    const waiting = cardReducer(cardReducer(start, { type: "buy-started" }), { type: "buy-settled", entry: entry({ kind: "needs-approval" }) });
    expect(canBuy(waiting)).toBe(false);
    const approving = cardReducer(waiting, { type: "approve-started" });
    expect(cardReducer(approving, { type: "approve-started" })).toBe(approving);
    expect(cardReducer(approving, { type: "approve-failed", message: "offline" }).status).toMatchObject({ phase: "needs-approval", approvalError: "offline" });
    expect(cardReducer(approving, { type: "approve-settled", entry: entry() }).status.phase).toBe("filled");
  });

  it("applies quotes without touching the trade status", () => {
    const buying = cardReducer(start, { type: "buy-started" });
    const updated = cardReducer(buying, { type: "quote-received", quote });
    expect(updated.market.yesCents).toBe(65);
    expect(updated.history).toHaveLength(3);
    expect(updated.status.phase).toBe("buying");
  });

  it("switches only to listed contracts and ignores quotes for a previous selection", () => {
    const other = { ...market, instrumentSymbol: "GEMI-FED261211-CUT25", contractLabel: "Cut 25bps", yesCents: 10 };
    const initial = initialCardState({ ...matched, contracts: [market, other] });
    expect(cardReducer(initial, { type: "contract-selected", symbol: "unlisted" })).toBe(initial);
    const selected = cardReducer(initial, { type: "contract-selected", symbol: other.instrumentSymbol });
    expect(selected.market).toBe(other);
    expect(cardReducer(selected, { type: "quote-received", quote })).toBe(selected);
    const buying = cardReducer(initial, { type: "buy-started" });
    expect(cardReducer(buying, { type: "contract-selected", symbol: other.instrumentSymbol })).toBe(buying);
    expect(cardReducer(buying, { type: "outcome-selected", outcome: "no" })).toBe(buying);
  });

  it("locks selection during approval and blocks missing prices", () => {
    const waiting = cardReducer(cardReducer(start, { type: "buy-started" }), { type: "buy-settled", entry: entry({ kind: "needs-approval" }) });
    expect(cardReducer(waiting, { type: "contract-selected", symbol: market.instrumentSymbol })).toBe(waiting);
    expect(cardReducer(waiting, { type: "outcome-selected", outcome: "no" })).toBe(waiting);
    expect(cardReducer(waiting, { type: "amount-edited", amountText: "5" })).toBe(waiting);
    expect(canBuy({ ...start, market: { ...market, yesCents: null } })).toBe(false);
  });

  it.each(["", "0", "-1", "1.234", "1e3", "Infinity", "1000.01", "9999999999999999"])("blocks an invalid dollar stake %j", (amountText) => {
    const state = cardReducer(start, { type: "amount-edited", amountText });
    expect(state.amountText).toBe(amountText);
    expect(canBuy(state)).toBe(false);
    expect(cardReducer(state, { type: "buy-started" })).toBe(state);
  });

  it("accepts custom dollar stakes and enforces Gemini quantity minimums", () => {
    expect(canBuy(cardReducer(start, { type: "amount-edited", amountText: "23.00" }))).toBe(true);
    expect(canBuy(cardReducer(start, { type: "amount-edited", amountText: "1000" }))).toBe(true);
    expect(canBuy({ ...start, market: { ...market, quantityLimits: { quantityIncrementHundredths: 100, quantityMinimumHundredths: 200 } } })).toBe(false);
  });
});
