import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Desk, HomeServices } from "@/features/desk";
import type { MarketPro } from "@/features/market-pro";
import { proShellSchema } from "@/shared";
import type { ProShell } from "@/shared";
import { GET } from "./route";

const getHomeServicesForRequest = vi.hoisted(() => vi.fn<() => Promise<HomeServices>>());

vi.mock("@/features/desk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/desk")>()),
  getHomeServicesForRequest,
}));

const SYMBOL = "GEMI-SOL261231-C200";
const shell = vi.fn<MarketPro["shell"]>();
const live = vi.fn<MarketPro["live"]>();

const sample = {
  generatedAt: "2026-11-19T18:00:00.000Z",
  market: {
    symbol: SYMBOL,
    eventTicker: "SOL261231",
    eventTitle: "SOL above $200?",
    displayTitle: "Solana price on Dec 31?",
    contractLabel: "$200",
    category: "Crypto",
    subcategory: null,
    expiryDate: "2026-12-31T22:00:00.000Z",
    eventStatus: "active",
    marketState: "open",
    asset: "SOL",
    imageUrl: null,
    volume: 84000,
    yesAskCents: 62,
    noAskCents: 39,
    yesBidCents: 61,
    noBidCents: 37,
    lastTradeCents: 62,
    bestBidCents: 61,
    bestAskCents: 62,
    quantityLimits: null,
  },
  stats: {
    last: { kind: "value", text: "62¢", tone: "neutral" },
    change24h: { kind: "value", text: "+9.0", tone: "up" },
    bidAsk: { kind: "value", text: "61 / 63", tone: "neutral" },
    highLow24h: { kind: "value", text: "63 / 52", tone: "neutral" },
    volume24h: { kind: "value", text: "$12.4k", tone: "neutral" },
    volumeTotal: { kind: "value", text: "$84.0k", tone: "neutral" },
    openInterest: { kind: "unavailable", reason: "Gemini does not publish open interest for prediction markets." },
    traders: { kind: "unavailable", reason: "Gemini does not publish a trader count for prediction markets." },
    resolvesIn: { kind: "value", text: "42d 4h", tone: "neutral" },
    maxPayout: { kind: "value", text: "$1.00", tone: "neutral" },
  },
  chart: {
    timeframe: "1D",
    candles: [],
    bands: [],
    ma7Last: null,
    ma20Last: null,
    bbLower: null,
    bbUpper: null,
    rsiLast: null,
    source: "live",
    note: null,
    overlay: null,
  },
  ladder: [],
  spot: null,
  budget: {
    dailyCapCents: 2000,
    spentCents: 0,
    remainingCents: 2000,
    perTradeMaxCents: 1000,
    autoApproveMaxCents: 200,
    resetAt: "2026-11-20T00:00:00.000Z",
    senderId: "priscilla",
  },
  position: null,
  watched: false,
  freshness: "live",
} satisfies ProShell;

const call = (symbol: string, query = "", headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
  GET(new Request(`http://localhost:3000/api/research/${symbol}/pro${query}`, { headers }), { params: Promise.resolve({ symbol }) });

beforeEach(() => {
  shell.mockReset().mockResolvedValue({ kind: "ok", shell: sample });
  live.mockReset().mockResolvedValue({ kind: "ok", live: {
    generatedAt: sample.generatedAt,
    book: { bids: [], asks: [], midCents: null, spreadCents: null, slippage500Cents: null, depthPlusMinus5: null, source: "unavailable" },
    trades: { items: [], source: "unavailable" },
    indicators: [],
    flow: null,
    feed: [],
    position: null,
    budget: sample.budget,
    watched: false,
  } });
  getHomeServicesForRequest.mockReset().mockResolvedValue({
    ok: true,
    desk: { flush: vi.fn<Desk["flush"]>(() => Promise.resolve()) } as unknown as Desk,
    research: { view: vi.fn(), brief: vi.fn() },
    catalog: {} as Extract<HomeServices, { ok: true }>["catalog"],
    marketPro: { shell, live },
  });
});

describe("GET /api/research/[symbol]/pro", () => {
  it("returns a schema-valid shell and lets the desk pick a default timeframe", async () => {
    const response = await call(SYMBOL);
    expect(response.status).toBe(200);
    expect(proShellSchema.parse(await response.json()).market.symbol).toBe(SYMBOL);
    expect(shell).toHaveBeenCalledWith(SYMBOL, undefined);
  });

  it("passes a requested timeframe and live part through", async () => {
    const response = await call(SYMBOL, "?part=live&timeframe=4h");
    expect(response.status).toBe(200);
    expect(live).toHaveBeenCalledWith(SYMBOL, "4h");
    expect(shell).not.toHaveBeenCalled();
  });

  it("rejects a malformed symbol and an unknown timeframe", async () => {
    expect((await call("nope")).status).toBe(400);
    expect((await call(SYMBOL, "?timeframe=5Y")).status).toBe(400);
    expect(shell).not.toHaveBeenCalled();
  });

  it("forbids cross-origin reads", async () => {
    const response = await call(SYMBOL, "", { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(shell).not.toHaveBeenCalled();
  });

  it("maps unknown and unavailable results", async () => {
    shell.mockResolvedValueOnce({ kind: "unknown-symbol" });
    expect((await call(SYMBOL)).status).toBe(404);
    shell.mockResolvedValueOnce({ kind: "unavailable" });
    expect((await call(SYMBOL)).status).toBe(503);
  });
});
