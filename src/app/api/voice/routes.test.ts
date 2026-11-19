import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Desk, DeskAccess } from "@/features/desk";
import type { DecisionLogEntry, DeskSnapshot } from "@/shared";
import { GET as session } from "./session/route";
import { POST as tool } from "./tools/[tool]/route";

const getDesk = vi.hoisted(() => vi.fn<() => Promise<DeskAccess>>());

vi.mock("@/features/desk", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/desk")>()), getDesk }));

const snapshot: DeskSnapshot = {
  news: { id: "n1", text: "Fed holds rates", postedAt: "2026-11-17T12:00:00.000Z" },
  match: {
    kind: "matched",
    market: {
      eventTicker: "FED", eventTitle: "Fed decision?", contractLabel: "Hold", instrumentSymbol: "GEMI-FED-HOLD",
      yesCents: 62, noCents: 40, marketState: "open",
    },
    reasons: ["fed"],
  },
  policy: {
    dailyCapCents: 2000, spentCents: 0, researchSpentCents: 0, remainingCents: 2000, autoApproveMaxCents: 200, perTradeMaxCents: 1000,
    killSwitch: false, marketAllowlist: [], marketCategories: ["Economics"], senderAllowlist: ["priscilla"],
  },
  pending: [],
  log: [],
  ledger: { configured: false, missing: [] },
};

const entry: DecisionLogEntry = {
  entryId: "e1", kind: "approve", spokenReason: "Done.", intentId: "i1", symbol: "GEMI-FED-HOLD", outcome: "yes",
  notionalCents: 100, senderId: "priscilla", source: "voice", at: "2026-11-17T12:00:00.000Z",
};

const proposeTrade = vi.fn<Desk["proposeTrade"]>();

const stubDesk: Desk = {
  submitNews: vi.fn(),
  proposeTrade,
  confirmPending: vi.fn(),
  matchPost: vi.fn(),
  isCardFor: vi.fn(),
  feedOrder: vi.fn(),
  quote: vi.fn(),
  postContextFor: vi.fn(),
  matchedPostsFor: vi.fn(),
  peekResearchBriefs: vi.fn(),
  getFeedPositions: vi.fn<Desk["getFeedPositions"]>(),
  getPositions: vi.fn(),
  reconcile: vi.fn(),
  buyDeepDive: vi.fn(),
  buyFromFeed: vi.fn(),
  confirmFromFeed: vi.fn(),
  setKillSwitch: vi.fn(),
  getSnapshot: () => Promise.resolve(snapshot),
};

const call = (name: string, body: unknown) =>
  tool(new Request("http://voice.test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ tool: name }),
  });

beforeEach(() => {
  proposeTrade.mockReset().mockResolvedValue(entry);
  vi.unstubAllEnvs();
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  vi.stubEnv("ELEVENLABS_AGENT_ID", "");
  vi.stubEnv("VOICE_OPERATOR_ID", "priscilla");
  getDesk.mockResolvedValue({ ok: true, desk: stubDesk, research: { view: vi.fn(), brief: vi.fn() }, deepDive: undefined, marketPro: { shell: vi.fn(), live: vi.fn() } });
});

describe("voice tool route", () => {
  it("returns 404 for an unknown tool", async () => {
    expect((await call("drop_tables", {})).status).toBe(404);
  });

  it.each([
    ["malformed json", "propose_trade", "{"],
    ["a bad amount", "propose_trade", { outcome: "yes", amount_usd: -3 }],
    ["fractional cents", "propose_trade", { outcome: "yes", amount_usd: 1.234 }],
    ["a bad outcome", "propose_trade", { outcome: "maybe", amount_usd: 1 }],
  ])("returns 400 with a speakable message for %s", async (_name, name, body) => {
    const response = await call(name, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: "invalid-request", say: expect.any(String) as unknown });
  });

  it("runs a tool against the desk and returns the spoken result", async () => {
    const quote = await call("get_market_quote", "");
    expect(quote.status).toBe(200);
    expect(await quote.json()).toMatchObject({ status: "quote", market: { yesCents: 62 } });
    const trade = await call("propose_trade", { outcome: "yes", amount_usd: 1 });
    expect(await trade.json()).toMatchObject({ status: "placed", say: "Done.", amountUsd: 1 });
    expect(proposeTrade).toHaveBeenCalledWith({
      instrumentSymbol: "GEMI-FED-HOLD", outcome: "yes", notionalCents: 100, source: "voice", senderId: "priscilla",
    });
  });

  it("uses VOICE_OPERATOR_ID as the sender and never calls the desk for invalid input", async () => {
    vi.stubEnv("VOICE_OPERATOR_ID", "sam");
    await call("propose_trade", { outcome: "yes", amount_usd: 2.5 });
    expect(proposeTrade).toHaveBeenCalledWith(expect.objectContaining({ senderId: "sam", notionalCents: 250 }));
    proposeTrade.mockClear();
    await call("propose_trade", { outcome: "yes", amount_usd: -1 });
    expect(proposeTrade).not.toHaveBeenCalled();
  });

  it("returns 503 when the desk is not configured", async () => {
    getDesk.mockResolvedValue({ ok: false, issues: ["DAILY_CAP_USD: required"] });
    expect((await call("get_desk_status", {})).status).toBe(503);
  });
});

describe("voice session route", () => {
  it("returns 503 listing the missing settings", async () => {
    const response = await session();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "voice-not-configured", missing: ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"] });
  });

  it("reports only the missing agent id when the key is present", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "secret-key");
    const response = await session();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain("ELEVENLABS_AGENT_ID");
    expect(text).not.toContain("secret-key");
  });
});
