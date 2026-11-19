import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Desk, DeskAccess } from "@/features/desk";
import type { Research } from "@/features/research";
import { PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER, decodeHeader, paymentRequiredSchema, settlementResponseSchema } from "@/features/x402";
import type { X402Server } from "@/features/x402";
import type { DeepDiveResult, ResearchBrief } from "@/shared";
import { POST as purchase } from "./[symbol]/deep/purchase/route";
import { GET as deep } from "./[symbol]/deep/route";

const getDesk = vi.hoisted(() => vi.fn<() => Promise<DeskAccess>>());

vi.mock("@/features/desk", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/desk")>()), getDesk }));

const SYMBOL = "GEMI-FED261211-MAINTAIN";
const URL_BASE = `http://desk.test/api/research/${SYMBOL}/deep`;
const context = (symbol = SYMBOL) => ({ params: Promise.resolve({ symbol }) });
const brief: ResearchBrief = { symbol: SYMBOL, generatedAt: "t", headline: "H", sections: [], polishedBy: "template" };

const requirements = vi.fn<X402Server["requirements"]>();
const verify = vi.fn<X402Server["verify"]>();
const settle = vi.fn<X402Server["settle"]>();
const polished = vi.fn(() => Promise.resolve(brief));
const briefFor = vi.fn<Research["brief"]>();
const buyDeepDive = vi.fn<Desk["buyDeepDive"]>();

function access(): DeskAccess {
  return {
    ok: true,
    desk: { buyDeepDive } as unknown as Desk,
    research: { view: vi.fn(), brief: briefFor },
    payments: { requirements, verify, settle },
  };
}

beforeEach(() => {
  requirements.mockReset().mockImplementation((symbol, resource, description, error) => ({
    x402Version: 1,
    error,
    accepts: [{
      scheme: "exact", network: "solana-localnet", maxAmountRequired: "50000", asset: "Mint", payTo: "Payee", resource, description,
      mimeType: "application/json", maxTimeoutSeconds: 120, extra: { nonce: "n", memo: `x402|${symbol}|n` },
    }],
  }));
  verify.mockReset().mockResolvedValue({ ok: true, value: { symbol: SYMBOL, nonce: "n", payment: { payer: "P", signature: "S", memo: "m", rawTransaction: Buffer.alloc(0) } } });
  settle.mockReset().mockResolvedValue({ ok: true, value: { signature: "S", payer: "P", network: "solana-localnet" } });
  polished.mockClear();
  briefFor.mockReset().mockResolvedValue({ kind: "ok", template: brief, polished });
  buyDeepDive.mockReset();
  getDesk.mockReset().mockResolvedValue(access());
});

describe("GET /api/research/[symbol]/deep", () => {
  it("answers an unpaid request with 402 and the x402 v1 requirements", async () => {
    const response = await deep(new Request(`${URL_BASE}?utm=1`), context());
    expect(response.status).toBe(402);
    const body = paymentRequiredSchema.parse(await response.json());
    expect(body).toMatchObject({ x402Version: 1, error: "payment_required", accepts: [{ resource: URL_BASE, maxAmountRequired: "50000" }] });
    expect(verify).not.toHaveBeenCalled();
    expect(briefFor).not.toHaveBeenCalled();
  });

  it("delivers the brief with a settlement receipt once the payment verifies and settles", async () => {
    const response = await deep(new Request(URL_BASE, { headers: { [PAYMENT_HEADER]: "payload" } }), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(brief);
    expect(decodeHeader(settlementResponseSchema, response.headers.get(PAYMENT_RESPONSE_HEADER) ?? "")).toEqual({
      success: true, transaction: "S", network: "solana-localnet", payer: "P",
    });
    expect(verify).toHaveBeenCalledWith("payload", SYMBOL);
  });

  it("answers a failed verification with 402, the specific error and a fresh nonce, and never settles", async () => {
    verify.mockResolvedValue({ ok: false, error: "wrong_amount" });
    const response = await deep(new Request(URL_BASE, { headers: { [PAYMENT_HEADER]: "payload" } }), context());
    expect(response.status).toBe(402);
    expect(paymentRequiredSchema.parse(await response.json()).error).toBe("wrong_amount");
    expect(settle).not.toHaveBeenCalled();
    expect(response.headers.get(PAYMENT_RESPONSE_HEADER)).toBeNull();
  });

  it("answers a failed settlement with 402 and withholds the brief", async () => {
    settle.mockResolvedValue({ ok: false, error: "settlement_failed" });
    const response = await deep(new Request(URL_BASE, { headers: { [PAYMENT_HEADER]: "payload" } }), context());
    expect(response.status).toBe(402);
    expect(paymentRequiredSchema.parse(await response.json()).error).toBe("settlement_failed");
    expect(polished).not.toHaveBeenCalled();
  });

  it("does not settle when the market data is unavailable, so nobody pays for nothing", async () => {
    briefFor.mockResolvedValue({ kind: "unavailable" });
    const response = await deep(new Request(URL_BASE, { headers: { [PAYMENT_HEADER]: "payload" } }), context());
    expect(response.status).toBe(503);
    expect(settle).not.toHaveBeenCalled();
  });

  it("rejects a malformed symbol and reports payments as unconfigured", async () => {
    expect((await deep(new Request(URL_BASE), context("nope"))).status).toBe(400);
    getDesk.mockResolvedValue({ ...access(), payments: undefined } as DeskAccess);
    const response = await deep(new Request(URL_BASE), context());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "research-payments-not-configured" });
  });
});

describe("POST /api/research/[symbol]/deep/purchase", () => {
  const result: DeepDiveResult = { status: "delivered", alreadyPurchased: false, trace: [], failureReason: null, brief, purchase: null };

  it("runs the purchase against the request's own origin", async () => {
    buyDeepDive.mockResolvedValue(result);
    const response = await purchase(new Request(`${URL_BASE}/purchase`, { method: "POST" }), context());
    expect(await response.json()).toEqual(result);
    expect(buyDeepDive).toHaveBeenCalledWith(SYMBOL, "http://desk.test");
  });

  it("refuses cross-origin posts and malformed symbols", async () => {
    const crossOrigin = await purchase(new Request(`${URL_BASE}/purchase`, { method: "POST", headers: { origin: "http://evil.test" } }), context());
    expect(crossOrigin.status).toBe(403);
    expect((await purchase(new Request(`${URL_BASE}/purchase`, { method: "POST" }), context("nope"))).status).toBe(400);
    expect(buyDeepDive).not.toHaveBeenCalled();
  });
});
