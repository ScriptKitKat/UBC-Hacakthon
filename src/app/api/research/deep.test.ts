import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Desk, DeskAccess } from "@/features/desk";
import type { DeepDiveResource } from "@/features/desk";
import type { DeepDiveResult, ResearchBrief } from "@/shared";
import { POST as purchase } from "./[symbol]/deep/purchase/route";
import { GET as deep } from "./[symbol]/deep/route";

const getDesk = vi.hoisted(() => vi.fn<() => Promise<DeskAccess>>());

vi.mock("@/features/desk", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/desk")>()), getDesk }));

const SYMBOL = "GEMI-FED261211-MAINTAIN";
const URL_BASE = `http://desk.test/api/research/${SYMBOL}/deep`;
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };
const context = (symbol = SYMBOL) => ({ params: Promise.resolve({ symbol }) });
const brief: ResearchBrief = { symbol: SYMBOL, generatedAt: "t", headline: "H", sections: [], polishedBy: "template" };

const handle = vi.fn<DeepDiveResource["handle"]>();
const buyDeepDive = vi.fn<Desk["buyDeepDive"]>();

function access(deepDive: DeepDiveResource | undefined = { urlFor: vi.fn(), handle, recover: vi.fn() }): DeskAccess {
  return { ok: true, desk: { buyDeepDive, flush: vi.fn<Desk["flush"]>(() => Promise.resolve()) } as unknown as Desk, research: { view: vi.fn(), brief: vi.fn() }, deepDive, marketPro: { shell: vi.fn(), live: vi.fn() }, chatter: undefined };
}

beforeEach(() => {
  handle.mockReset().mockResolvedValue(Response.json(brief));
  buyDeepDive.mockReset();
  getDesk.mockReset().mockResolvedValue(access());
});

describe("GET /api/research/[symbol]/deep", () => {
  it("hands the request to the deep dive resource for the symbol and returns its answer", async () => {
    const request = new Request(URL_BASE);
    const response = await deep(request, context());
    expect(handle).toHaveBeenCalledWith(request, SYMBOL);
    expect(await response.json()).toEqual(brief);
  });

  it("rejects a malformed symbol before touching the resource", async () => {
    expect((await deep(new Request(URL_BASE), context("nope"))).status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });

  it("reports unconfigured payments and a misconfigured desk as 503", async () => {
    getDesk.mockResolvedValue({ ...access(), deepDive: undefined, marketPro: { shell: vi.fn(), live: vi.fn() }, chatter: undefined } as DeskAccess);
    const unconfigured = await deep(new Request(URL_BASE), context());
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toEqual({ error: "research-payments-not-configured" });
    getDesk.mockResolvedValue({ ok: false, issues: ["storage: broken"] });
    expect(await (await deep(new Request(URL_BASE), context())).json()).toEqual({ error: "desk-misconfigured", issues: ["storage: broken"] });
  });
});

describe("POST /api/research/[symbol]/deep/purchase", () => {
  const result: DeepDiveResult = { status: "delivered", alreadyPurchased: false, trace: [], failureReason: null, brief, purchase: null };
  const post = (headers: Record<string, string>, symbol = SYMBOL) =>
    purchase(new Request(`${URL_BASE}/purchase`, { method: "POST", headers }), context(symbol));

  it("buys the brief for a dashboard request and never forwards any request-derived origin", async () => {
    buyDeepDive.mockResolvedValue(result);
    const response = await post(SAME_ORIGIN);
    expect(await response.json()).toEqual(result);
    expect(buyDeepDive).toHaveBeenCalledExactlyOnceWith(SYMBOL);
  });

  it("refuses a post with no browser provenance, a foreign origin, another scheme or a cross-site fetch", async () => {
    for (const headers of [{}, { origin: "http://evil.test" }, { origin: "https://desk.test" }, { "sec-fetch-site": "cross-site" }]) {
      expect((await post(headers)).status).toBe(403);
    }
    expect(buyDeepDive).not.toHaveBeenCalled();
  });

  it("accepts a same-origin Origin header and rejects malformed symbols", async () => {
    buyDeepDive.mockResolvedValue(result);
    expect((await post({ origin: "http://desk.test" })).status).toBe(200);
    expect((await post(SAME_ORIGIN, "nope")).status).toBe(400);
  });
});
