import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Research } from "@/features/research";
import { PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER, decodeHeader, paymentRequiredSchema, settlementResponseSchema } from "@/features/x402";
import type { X402Server } from "@/features/x402";
import type { ResearchBrief } from "@/shared";
import { createDeepDiveResource, createDeferredDeepDive } from "./deep-dive-resource";

const SYMBOL = "GEMI-FED261211-MAINTAIN";
const PUBLIC_ORIGIN = "http://desk.canonical.test";
const CANONICAL_URL = `${PUBLIC_ORIGIN}/api/research/${SYMBOL}/deep`;
const URL_BASE = `http://attacker.test/api/research/${SYMBOL}/deep`;
const brief: ResearchBrief = { symbol: SYMBOL, generatedAt: "t", headline: "H", sections: [], polishedBy: "template" };

const requirements = vi.fn<X402Server["requirements"]>();
const verify = vi.fn<X402Server["verify"]>();
const settle = vi.fn<X402Server["settle"]>();
const recover = vi.fn<X402Server["recover"]>();
const polished = vi.fn(() => Promise.resolve(brief));
const briefFor = vi.fn<Research["brief"]>();

const resource = createDeepDiveResource({
  payments: { requirements, verify, settle, recover },
  research: { view: vi.fn(), brief: briefFor },
  publicOrigin: PUBLIC_ORIGIN,
});

beforeEach(() => {
  requirements.mockReset().mockImplementation((symbol, description, error) => ({
    x402Version: 1,
    error,
    accepts: [{
      scheme: "exact", network: "solana-localnet", maxAmountRequired: "50000", asset: "Mint", payTo: "Payee", resource: resource.urlFor(symbol), description,
      mimeType: "application/json", maxTimeoutSeconds: 120, extra: { nonce: "n", memo: `x402|${symbol}|n` },
    }],
  }));
  verify.mockReset().mockResolvedValue({ ok: true, value: { symbol: SYMBOL, nonce: "n", simulationSlot: 1, payment: { payer: "P", signature: "S", memo: "m", rawTransaction: Buffer.alloc(0) } } });
  settle.mockReset().mockResolvedValue({ ok: true, value: { signature: "S", payer: "P", network: "solana-localnet" } });
  recover.mockReset();
  polished.mockClear();
  briefFor.mockReset().mockResolvedValue({ kind: "ok", template: brief, polished });
});

describe("deep dive resource", () => {
  it("answers an unpaid request with 402 and the x402 v1 requirements", async () => {
    const response = await resource.handle(new Request(`${URL_BASE}?utm=1`), SYMBOL);
    expect(response.status).toBe(402);
    const body = paymentRequiredSchema.parse(await response.json());
    expect(body).toMatchObject({ x402Version: 1, error: "payment_required", accepts: [{ resource: CANONICAL_URL, maxAmountRequired: "50000" }] });
    expect(verify).not.toHaveBeenCalled();
    expect(briefFor).not.toHaveBeenCalled();
  });

  it("delivers the brief with a settlement receipt once the payment verifies and settles", async () => {
    const response = await resource.handle(new Request(URL_BASE, { headers: { [PAYMENT_HEADER]: "payload" } }), SYMBOL);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(brief);
    expect(decodeHeader(settlementResponseSchema, response.headers.get(PAYMENT_RESPONSE_HEADER) ?? "")).toEqual({
      success: true, transaction: "S", network: "solana-localnet", payer: "P",
    });
    expect(verify).toHaveBeenCalledWith("payload", SYMBOL);
  });

  it("answers a failed verification with 402, the specific error and a fresh nonce, and never settles", async () => {
    verify.mockResolvedValue({ ok: false, error: "wrong_amount" });
    const response = await resource.handle(new Request(URL_BASE, { headers: { [PAYMENT_HEADER]: "payload" } }), SYMBOL);
    expect(response.status).toBe(402);
    expect(paymentRequiredSchema.parse(await response.json()).error).toBe("wrong_amount");
    expect(settle).not.toHaveBeenCalled();
    expect(response.headers.get(PAYMENT_RESPONSE_HEADER)).toBeNull();
  });

  it("answers a failed settlement with 402 and withholds the brief", async () => {
    settle.mockResolvedValue({ ok: false, error: "settlement_failed" });
    const response = await resource.handle(new Request(URL_BASE, { headers: { [PAYMENT_HEADER]: "payload" } }), SYMBOL);
    expect(response.status).toBe(402);
    expect(paymentRequiredSchema.parse(await response.json()).error).toBe("settlement_failed");
    expect(polished).not.toHaveBeenCalled();
  });

  it("does not settle when the market data is unavailable, so nobody pays for nothing", async () => {
    briefFor.mockResolvedValue({ kind: "unavailable" });
    const response = await resource.handle(new Request(URL_BASE, { headers: { [PAYMENT_HEADER]: "payload" } }), SYMBOL);
    expect(response.status).toBe(503);
    expect(settle).not.toHaveBeenCalled();
  });

  it("names the configured canonical resource, never the host the request claimed", async () => {
    const response = await resource.handle(new Request(URL_BASE), SYMBOL);
    expect(paymentRequiredSchema.parse(await response.json()).accepts[0]?.resource).toBe(CANONICAL_URL);
    expect(resource.urlFor(SYMBOL)).toBe(CANONICAL_URL);
  });

  it("recovers the brief for a signature the server settled, without asking for payment", async () => {
    recover.mockResolvedValue({ ok: true, value: { signature: "S", payer: "P", network: "solana-localnet" } });
    expect(await resource.recover(SYMBOL, "S")).toEqual(brief);
    expect(recover).toHaveBeenCalledWith(SYMBOL, "S");
    expect(settle).not.toHaveBeenCalled();
  });

  it("recovers nothing for an unknown payment or when the brief cannot be built", async () => {
    recover.mockResolvedValue({ ok: false, error: "unknown_payment" });
    expect(await resource.recover(SYMBOL, "S")).toBeUndefined();
    recover.mockResolvedValue({ ok: true, value: { signature: "S", payer: "P", network: "solana-localnet" } });
    briefFor.mockResolvedValue({ kind: "unavailable" });
    expect(await resource.recover(SYMBOL, "S")).toBeUndefined();
  });
});

describe("deferred deep dive resource", () => {
  it("answers 503 and recovers nothing until a real resource is bound, then delegates", async () => {
    const deferred = createDeferredDeepDive(PUBLIC_ORIGIN);
    expect(deferred.resource.urlFor(SYMBOL)).toBe(CANONICAL_URL);
    expect((await deferred.resource.handle(new Request(CANONICAL_URL), SYMBOL)).status).toBe(503);
    expect(await deferred.resource.recover(SYMBOL, "S")).toBeUndefined();
    deferred.bind(resource);
    expect((await deferred.resource.handle(new Request(CANONICAL_URL), SYMBOL)).status).toBe(402);
  });
});
