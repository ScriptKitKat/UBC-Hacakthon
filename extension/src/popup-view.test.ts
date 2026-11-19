import type { FeedPositions } from "@/shared";
import { describe, expect, it } from "vitest";
import { renderPositions } from "./popup-view";

const deskUrl = "https://desk.test";
const position: FeedPositions["positions"][number] = {
  symbol: "GEMI-FED-HOLD", outcome: "yes", eventTitle: "Fed decision?", contractLabel: "Hold",
  contracts: 2.5, averageEntryCents: 40.25, currentCents: 50, pnlCents: 25, pnlPercent: 25,
  explorerUrl: "https://explorer.test/tx/latest", researchPath: "/markets/GEMI-FED-HOLD",
};
const view: FeedPositions = {
  positions: [position],
  totals: { costCents: 100, pricedCostCents: 100, valueCents: 125, pnlCents: 25, pnlPercent: 25, unpricedPositions: 0 },
  budget: { dailyCapCents: 2000, spentCents: 105, remainingCents: 1895, researchSpentCents: 5, perTradeMaxCents: 1000, autoApproveMaxCents: 200 },
};

describe("popup positions view", () => {
  it("renders the budget, position, signed P&L and new-tab links", () => {
    const root = renderPositions({ ok: true, value: view }, deskUrl);
    expect(root.querySelector("h1")?.textContent).toBe("Today: $18.95 left of $20.00");
    expect(root.querySelector("li")?.textContent).toContain("Fed decision?YESHold");
    expect(root.textContent).toContain("2.5 @ 40.25¢ → 50¢");
    expect(root.querySelector(".details [data-tone=up]")?.textContent).toBe("+$0.25 (+25%)");
    expect(Array.from(root.querySelectorAll("a"), ({ textContent, href, target, rel }) => [textContent, href, target, rel])).toEqual([
      ["↗", "https://explorer.test/tx/latest", "_blank", "noopener noreferrer"],
      ["Research", "https://desk.test/markets/GEMI-FED-HOLD", "_blank", "noopener noreferrer"],
    ]);
  });

  it("displays missing bids and skips unsafe links", () => {
    const unpriced = { ...position, currentCents: null, pnlCents: null, pnlPercent: null, explorerUrl: "javascript:alert(1)", researchPath: "//other.test" };
    const root = renderPositions({ ok: true, value: { ...view, positions: [unpriced] } }, deskUrl);
    expect(root.textContent).toContain("→ no bid");
    expect(root.querySelector(".details [data-tone=flat]")?.textContent).toBe("—");
    expect(root.querySelector("a")).toBeNull();
  });

  it("renders the empty state", () => {
    const root = renderPositions({ ok: true, value: { ...view, positions: [] } }, deskUrl);
    expect(root.textContent).toContain("No open positions");
  });

  it.each(["Can't reach the desk. Is it running?", "Set a desk token in the extension options."])("links to options on error", (error) => {
    const root = renderPositions({ ok: false, error }, deskUrl);
    expect(root.textContent).toContain(error);
    expect(root.querySelector("a")?.getAttribute("href")).toBe("options.html");
  });
});
