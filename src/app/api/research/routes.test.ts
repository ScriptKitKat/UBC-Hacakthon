import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Desk, DeskAccess } from "@/features/desk";
import type { Research } from "@/features/research";
import { researchViewSchema } from "@/shared";
import type { PositionsView, ResearchView } from "@/shared";
import { GET as positions } from "../positions/route";
import { GET as research } from "./[symbol]/route";

const getDesk = vi.hoisted(() => vi.fn<() => Promise<DeskAccess>>());

vi.mock("@/features/desk", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/desk")>()), getDesk }));

const SYMBOL = "GEMI-FED261211-MAINTAIN";
const view = vi.fn<Research["view"]>();
const getPositions = vi.fn<Desk["getPositions"]>();

const sampleView: ResearchView = {
  symbol: SYMBOL,
  generatedAt: "2026-11-18T00:00:00.000Z",
  timeframe: "1D",
  market: {
    eventTicker: "FED261211", eventTitle: "Fed decision in December?", contractLabel: "Fed maintains rate", category: "Economics", subcategory: null,
    expiryDate: null, eventStatus: "active", marketState: "open", rulesText: "", volume: null, volume24h: null,
    prices: { buyYesCents: 62, buyNoCents: 40, sellYesCents: 60, sellNoCents: 38, bestBidCents: 60, bestAskCents: 62, lastTradeCents: 61 },
  },
  data: { event: "live", candles: "live", book: "live", trades: "live" },
  series: { source: "none", points: [] },
  book: { bids: [], asks: [] },
  trades: [],
  indicators: {
    momentum: { value: null, zone: null, reading: "Not enough trading yet to measure momentum." },
    jumpiness: { value: null, mean: null, upper: null, lower: null, outsideBand: false, reading: "x" },
    volumeSpike: { ratio: null, obvTrend: null, reading: "x" },
    averagePrice: { value: null, window: 0, reading: "x" },
    recentMove: { hourCents: null, dayCents: null, reading: "x" },
  },
  related: { sameEvent: [], sameCategory: [] },
  postContext: null,
};

const emptyPositions: PositionsView = {
  generatedAt: "2026-11-18T00:00:00.000Z",
  positions: [],
  totals: { costCents: 0, pricedCostCents: 0, valueCents: 0, pnlCents: 0, pnlPercent: null, unpricedPositions: 0 },
};

const call = (symbol: string, query = "", headers: Record<string, string> = {}) =>
  research(new Request(`http://localhost:3000/api/research/${symbol}${query}`, { headers }), { params: Promise.resolve({ symbol }) });

beforeEach(() => {
  view.mockReset().mockResolvedValue({ kind: "ok", view: sampleView });
  getPositions.mockReset().mockResolvedValue(emptyPositions);
  getDesk.mockReset().mockResolvedValue({ ok: true, desk: { getPositions } as unknown as Desk, research: { view } });
});

describe("GET /api/research/[symbol]", () => {
  it("returns a schema-valid view and defaults the timeframe to 1D", async () => {
    const response = await call(SYMBOL);
    expect(response.status).toBe(200);
    expect(researchViewSchema.parse(await response.json()).symbol).toBe(SYMBOL);
    expect(view).toHaveBeenCalledWith(SYMBOL, "1D");
  });

  it("passes a requested timeframe through", async () => {
    await call(SYMBOL, "?timeframe=1W");
    expect(view).toHaveBeenCalledWith(SYMBOL, "1W");
  });

  it.each(["nope", "GEMI-FED261211", "gemi-fed261211-maintain", "GEMI-FED%3Fx-Y"])("rejects the malformed symbol %s with 400", async (symbol) => {
    const response = await call(symbol);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid-request" });
    expect(view).not.toHaveBeenCalled();
  });

  it("rejects an unknown timeframe with 400", async () => {
    const response = await call(SYMBOL, "?timeframe=5Y");
    expect(response.status).toBe(400);
    expect(view).not.toHaveBeenCalled();
  });

  it("returns 404 json for a symbol Gemini does not know", async () => {
    view.mockResolvedValue({ kind: "unknown-symbol" });
    const response = await call("GEMI-NOPE-NOPE");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "unknown-symbol" });
  });

  it("returns 503 when Gemini is unavailable and nothing is cached", async () => {
    view.mockResolvedValue({ kind: "unavailable" });
    const response = await call(SYMBOL);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "gemini-unavailable" });
  });

  it("returns 503 with the config issues when the desk is not configured", async () => {
    getDesk.mockResolvedValue({ ok: false, issues: ["DAILY_CAP_USD: required"] });
    const response = await call(SYMBOL);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "desk-misconfigured" });
  });

  it("refuses cross-origin browser reads", async () => {
    const response = await call(SYMBOL, "", { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(view).not.toHaveBeenCalled();
  });

  it("allows same-origin reads", async () => {
    expect((await call(SYMBOL, "", { origin: "http://localhost:3000" })).status).toBe(200);
  });
});

describe("GET /api/positions", () => {
  it("returns the positions view", async () => {
    const response = await positions(new Request("http://localhost:3000/api/positions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(emptyPositions);
  });

  it("refuses cross-origin browser reads", async () => {
    const response = await positions(new Request("http://localhost:3000/api/positions", { headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(getPositions).not.toHaveBeenCalled();
  });

  it("returns 503 when the desk is not configured", async () => {
    getDesk.mockResolvedValue({ ok: false, issues: ["x"] });
    expect((await positions(new Request("http://localhost:3000/api/positions"))).status).toBe(503);
  });
});
