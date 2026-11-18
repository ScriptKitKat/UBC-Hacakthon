import { describe, expect, it } from "vitest";
import { canBuy, cardReducer, initialCardState, statusFromEntry } from "./card-state";
import { entry, market, matched, quote } from "./fixtures";

const start = initialCardState(matched);

describe("card state machine", () => {
  it("starts idle with a $1 default", () => {
    expect(start).toMatchObject({ amountCents: 100, status: { phase: "idle" } });
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
    expect(cardReducer(buying, { type: "amount-selected", amountCents: 500 })).toBe(buying);
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
});
