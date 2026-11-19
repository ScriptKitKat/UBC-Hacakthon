import { describe, expect, it, vi } from "vitest";
import { createPolicy } from "@/features/guardrails";
import type { UsdcLedger } from "@/features/ledger";
import { fail } from "@/features/markets";
import type { GeminiMarketsClient } from "@/features/markets";
import { createMemoryFileSystem } from "@/features/storage";
import { PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER, encodeHeader } from "@/features/x402";
import { usdCents } from "@/shared";
import type { LedgerView, ResearchBrief } from "@/shared";
import { createDesk } from "./desk";
import type { DeskDeps } from "./desk";
import { openDecisionLog } from "./log-store";
import { openPurchaseStore } from "./purchase-store";

const SYMBOL = "GEMI-FED261211-MAINTAIN";
const ORIGIN = "http://desk.test";
const MINT = "Mint1111111111111111111111111111111111111111";
const RECIPIENT = "Recipient111111111111111111111111111111111";
const AUTHORITY = "Authority11111111111111111111111111111111";
function urlOf(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

const START = Date.parse("2026-11-17T12:00:00Z");

const ledgerView: LedgerView = { configured: true, cluster: "localnet", authority: AUTHORITY, mint: MINT, recipient: "Vault" };
const brief: ResearchBrief = { symbol: SYMBOL, generatedAt: "2026-11-17T12:00:00Z", headline: "H", sections: [{ title: "T", body: "B" }], polishedBy: "template" };

type Requirement = { network: string; asset: string; payTo: string; maxAmountRequired: string; resource: string };

function requirementsBody(overrides: Partial<Requirement> = {}, nonce = "nonce-1", error = "payment_required") {
  return {
    x402Version: 1,
    error,
    accepts: [{
      scheme: "exact", network: "solana-localnet", maxAmountRequired: "50000", asset: MINT, payTo: RECIPIENT,
      resource: `${ORIGIN}/api/research/${SYMBOL}/deep`, description: "d", mimeType: "application/json", maxTimeoutSeconds: 120,
      extra: { nonce, memo: `x402|${SYMBOL}|${nonce}` }, ...overrides,
    }],
  };
}

function settledResponse(signature: string, overrides: Record<string, unknown> = {}) {
  const header = encodeHeader({ success: true, transaction: signature, network: "solana-localnet", payer: AUTHORITY, ...overrides });
  return Response.json(brief, { headers: { [PAYMENT_RESPONSE_HEADER]: header } });
}

interface Script {
  readonly requirements?: Response | (() => Response);
  readonly paid?: Response | (() => Response) | "throw";
  readonly signature?: string;
}

function fixture(options: { noResearch?: boolean; dailyCap?: number; killSwitch?: boolean; script?: Script; extra?: Partial<DeskDeps>; start?: number } = {}) {
  let nonceCounter = 0;
  const script = options.script ?? {};
  const dailyCap = options.dailyCap ?? 2000;
  const signature = script.signature ?? "sig-1";
  const signPayment = vi.fn<UsdcLedger["signPayment"]>(() =>
    Promise.resolve({ ok: true, value: { signature, transaction: "dHg=", payer: AUTHORITY, explorerUrl: `https://explorer.test/tx/${signature}` } }),
  );
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const paying = new Headers(init?.headers).has(PAYMENT_HEADER);
    if (!paying) {
      nonceCounter += 1;
      const custom = script.requirements;
      if (custom) return Promise.resolve(typeof custom === "function" ? custom() : custom.clone());
      return Promise.resolve(Response.json(requirementsBody({ resource: urlOf(input) }, `nonce-${String(nonceCounter)}`), { status: 402 }));
    }
    const custom = script.paid;
    if (custom === "throw") return Promise.reject(new Error("socket hang up"));
    if (custom) return Promise.resolve(typeof custom === "function" ? custom() : custom.clone());
    return Promise.resolve(settledResponse(signature));
  });
  const policy = createPolicy({
    dailyCap: usdCents(dailyCap), autoApproveMax: usdCents(Math.min(200, dailyCap)), perTradeMax: usdCents(Math.min(1000, dailyCap)),
    marketAllowlist: new Set(), marketCategories: new Set(["Economics"]), senderAllowlist: new Set(["priscilla"]), killSwitch: options.killSwitch ?? false,
  });
  if (!policy.ok) throw new Error("invalid policy");
  let ids = 0;
  const markets: Pick<GeminiMarketsClient, "searchEvents" | "getEvent"> = {
    searchEvents: () => Promise.resolve(fail({ kind: "network" })),
    getEvent: () => Promise.resolve(fail({ kind: "network" })),
  };
  const clock = { nowMs: options.start ?? START };
  const desk = createDesk({
    policy: policy.value,
    feed: { operatorId: "priscilla", grok: { apiKey: undefined, model: "m" } },
    markets,
    ledger: { debit: vi.fn(), signPayment, balance: vi.fn() },
    ledgerView,
    fetch: fetchMock,
    now: () => new Date(clock.nowMs),
    idGen: () => `id-${String(++ids)}`,
    ...(options.noResearch ? {} : { research: { recipient: RECIPIENT, maxPriceCents: usdCents(5) } }),
    ...options.extra,
  });
  return { desk, fetchMock, signPayment, clock };
}

describe("buyDeepDive", () => {
  it("walks requirements, guardrails, signing, settlement and delivery, and logs the spend", async () => {
    const { desk, fetchMock, signPayment } = fixture();
    const result = await desk.buyDeepDive(SYMBOL, ORIGIN);
    expect(result.status).toBe("delivered");
    expect(result.alreadyPurchased).toBe(false);
    expect(result.brief).toEqual(brief);
    expect(result.trace.map((step) => step.step)).toEqual(["requirements", "guardrails", "signed", "settled", "brief"]);
    expect(result.trace[1]).toMatchObject({ remainingCents: 1995 });
    expect(result.trace[3]).toMatchObject({ signature: "sig-1", explorerUrl: "https://explorer.test/tx/sig-1" });
    expect(signPayment).toHaveBeenCalledWith({ recipient: RECIPIENT, notional: 5, memo: `x402|${SYMBOL}|nonce-1` });
    const [, paidCall] = fetchMock.mock.calls;
    expect(urlOf(paidCall?.[0] ?? "")).toBe(`${ORIGIN}/api/research/${SYMBOL}/deep`);
    expect(new Headers(paidCall?.[1]?.headers).get(PAYMENT_HEADER)).toBeTruthy();
    const snapshot = await desk.getSnapshot();
    expect(snapshot.log[0]).toMatchObject({
      kind: "approve", source: "research", outcome: null, notionalCents: 5, symbol: SYMBOL, signature: "sig-1", explorerUrl: "https://explorer.test/tx/sig-1",
    });
    expect(snapshot.policy).toMatchObject({ spentCents: 5, remainingCents: 1995, researchSpentCents: 5 });
  });

  it("keeps research out of positions and reports it as research spend", async () => {
    const { desk } = fixture();
    await desk.buyDeepDive(SYMBOL, ORIGIN);
    const positions = await desk.getPositions();
    expect(positions.positions).toEqual([]);
    expect(positions.researchSpend).toMatchObject({ todayCents: 5, purchases: [{ symbol: SYMBOL, costCents: 5, signature: "sig-1" }] });
  });

  it("does not pay again when the brief was bought in the last 15 minutes", async () => {
    const { desk, fetchMock, signPayment, clock } = fixture();
    await desk.buyDeepDive(SYMBOL, ORIGIN);
    clock.nowMs += 14 * 60 * 1000;
    const again = await desk.buyDeepDive(SYMBOL, ORIGIN);
    expect(again).toMatchObject({ status: "delivered", alreadyPurchased: true, brief, purchase: { signature: "sig-1", costCents: 5 } });
    expect(signPayment).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await desk.getSnapshot()).policy.spentCents).toBe(5);
  });

  it("pays again for the same symbol after 15 minutes", async () => {
    const { desk, signPayment, clock } = fixture();
    await desk.buyDeepDive(SYMBOL, ORIGIN);
    clock.nowMs += 15 * 60 * 1000;
    const again = await desk.buyDeepDive(SYMBOL, ORIGIN);
    expect(again.alreadyPurchased).toBe(false);
    expect(signPayment).toHaveBeenCalledTimes(2);
    expect((await desk.getSnapshot()).policy.spentCents).toBe(10);
  });

  it("collapses concurrent purchases of the same symbol into one payment", async () => {
    const { desk, signPayment } = fixture();
    const [first, second] = await Promise.all([desk.buyDeepDive(SYMBOL, ORIGIN), desk.buyDeepDive(SYMBOL, ORIGIN)]);
    expect(first).toBe(second);
    expect(signPayment).toHaveBeenCalledOnce();
  });

  it("restores a bought brief after a restart so it is not bought twice", async () => {
    const fs = createMemoryFileSystem();
    const store = await openPurchaseStore({ fs, path: "/d/purchases.json" });
    const first = fixture({ extra: { initialPurchases: store.initialPurchases, savePurchases: store.savePurchases } });
    await first.desk.buyDeepDive(SYMBOL, ORIGIN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = await openPurchaseStore({ fs, path: "/d/purchases.json" });
    const second = fixture({ extra: { initialPurchases: reopened.initialPurchases, savePurchases: reopened.savePurchases } });
    expect(await second.desk.buyDeepDive(SYMBOL, ORIGIN)).toMatchObject({ alreadyPurchased: true, brief });
    expect(second.signPayment).not.toHaveBeenCalled();
  });

  describe("guardrail refusals", () => {
    it("refuses with the kill switch on, makes no payment, and logs it", async () => {
      const { desk, signPayment } = fixture({ killSwitch: true });
      const result = await desk.buyDeepDive(SYMBOL, ORIGIN);
      expect(result).toMatchObject({ status: "refused", failureReason: "Trading is paused, so I did not buy research.", brief: null });
      expect(result.trace.map((step) => step.step)).toEqual(["requirements"]);
      expect(signPayment).not.toHaveBeenCalled();
      expect((await desk.getSnapshot()).log[0]).toMatchObject({ kind: "refuse", source: "research", code: "kill-switch" });
    });

    it("refuses once research has used up the budget, with a spoken reason", async () => {
      const { desk, signPayment, clock } = fixture({ dailyCap: 10 });
      await desk.buyDeepDive("GEMI-A-ONE", ORIGIN);
      await desk.buyDeepDive("GEMI-B-TWO", ORIGIN);
      clock.nowMs += 1000;
      const third = await desk.buyDeepDive("GEMI-C-THREE", ORIGIN);
      expect(third).toMatchObject({ status: "refused", failureReason: "A $0.05 research purchase would exceed today's $0.10 budget, with $0 left." });
      expect(signPayment).toHaveBeenCalledTimes(2);
    });
  });

  describe("requirement checks", () => {
    it.each([
      ["a different token", { asset: "OtherMint" }, "different token"],
      ["a different recipient", { payTo: "Someone" }, "address the desk doesn't recognise"],
      ["a different network", { network: "solana-devnet" }, "wants payment on solana-devnet"],
      ["a higher price", { maxAmountRequired: "60000" }, "more than the $0.05"],
      ["a fractional-cent price", { maxAmountRequired: "50001" }, "whole number of cents"],
      ["a different resource", { resource: `${ORIGIN}/api/research/OTHER/deep` }, "different resource"],
    ])("refuses to pay when asked for %s", async (_name, change, reason) => {
      const { desk, signPayment } = fixture({ script: { requirements: Response.json(requirementsBody(change), { status: 402 }) } });
      const result = await desk.buyDeepDive(SYMBOL, ORIGIN);
      expect(result.status).toBe("failed");
      expect(result.failureReason).toContain(reason);
      expect(result.trace).toEqual([]);
      expect(signPayment).not.toHaveBeenCalled();
      expect((await desk.getSnapshot()).log).toEqual([]);
    });

    it("fails cleanly when the endpoint does not ask for payment or sends garbage", async () => {
      const free = fixture({ script: { requirements: Response.json(brief) } });
      expect((await free.desk.buyDeepDive(SYMBOL, ORIGIN)).failureReason).toContain("didn't ask for payment");
      const garbage = fixture({ script: { requirements: Response.json({ nope: true }, { status: 402 }) } });
      expect((await garbage.desk.buyDeepDive(SYMBOL, ORIGIN)).failureReason).toContain("couldn't read");
    });

    it("fails when the ledger or research recipient is not configured", async () => {
      const noLedger = fixture({ extra: { ledgerView: { configured: false, missing: ["X"] } } });
      expect((await noLedger.desk.buyDeepDive(SYMBOL, ORIGIN)).failureReason).toContain("ledger isn't configured");
      const noResearch = fixture({ noResearch: true });
      expect((await noResearch.desk.buyDeepDive(SYMBOL, ORIGIN)).failureReason).toContain("aren't configured");
    });
  });

  describe("payment failures release the reservation", () => {
    it("releases the budget when the server rejects the payment", async () => {
      const rejected = Response.json(requirementsBody({}, "n2", "wrong_amount"), { status: 402 });
      const { desk } = fixture({ script: { paid: rejected } });
      const result = await desk.buyDeepDive(SYMBOL, ORIGIN);
      expect(result).toMatchObject({ status: "failed", brief: null });
      expect(result.failureReason).toContain("wrong_amount");
      expect(result.trace.map((step) => step.step)).toEqual(["requirements", "guardrails", "signed"]);
      const snapshot = await desk.getSnapshot();
      expect(snapshot.policy).toMatchObject({ spentCents: 0, remainingCents: 2000 });
      expect(snapshot.log[0]).toMatchObject({ kind: "execution-failed", source: "research", code: "wrong_amount" });
    });

    it("releases the budget when signing fails", async () => {
      const f = fixture();
      f.signPayment.mockResolvedValueOnce({ ok: false, error: { code: "recipient-ata-missing" } });
      const result = await f.desk.buyDeepDive(SYMBOL, ORIGIN);
      expect(result).toMatchObject({ status: "failed", failureReason: "I couldn't sign the payment, so nothing was spent." });
      expect((await f.desk.getSnapshot()).policy.remainingCents).toBe(2000);
    });

    it("keeps the funds reserved when settlement could not be confirmed", async () => {
      const unconfirmed = Response.json(requirementsBody({}, "n2", "settlement_failed"), { status: 402 });
      const { desk } = fixture({ script: { paid: unconfirmed } });
      const result = await desk.buyDeepDive(SYMBOL, ORIGIN);
      expect(result.failureReason).toContain("funds stay reserved");
      expect((await desk.getSnapshot()).policy).toMatchObject({ spentCents: 0, remainingCents: 1995 });
    });

    it("keeps the funds reserved when the paid request never answers", async () => {
      const { desk } = fixture({ script: { paid: "throw" } });
      const result = await desk.buyDeepDive(SYMBOL, ORIGIN);
      expect(result.failureReason).toContain("never heard back");
      expect((await desk.getSnapshot()).policy.remainingCents).toBe(1995);
    });

    it.each([
      ["a receipt for another transaction", { transaction: "other" }],
      ["a receipt naming another payer", { payer: "Mallory" }],
      ["a receipt for another network", { network: "solana-devnet" }],
    ])("distrusts %s", async (_name, overrides) => {
      const { desk } = fixture({ script: { paid: settledResponse("sig-1", overrides) } });
      const result = await desk.buyDeepDive(SYMBOL, ORIGIN);
      expect(result).toMatchObject({ status: "failed", brief: null });
      expect(result.failureReason).toContain("receipt didn't match");
      expect((await desk.getSnapshot()).policy.spentCents).toBe(0);
    });

    it("distrusts a 200 without a receipt header", async () => {
      const { desk } = fixture({ script: { paid: Response.json(brief) } });
      expect((await desk.buyDeepDive(SYMBOL, ORIGIN)).status).toBe("failed");
    });

    it("records the spend even if the delivered brief is unreadable", async () => {
      const header = encodeHeader({ success: true, transaction: "sig-1", network: "solana-localnet", payer: AUTHORITY });
      const { desk } = fixture({ script: { paid: new Response("{}", { headers: { [PAYMENT_RESPONSE_HEADER]: header } }) } });
      const result = await desk.buyDeepDive(SYMBOL, ORIGIN);
      expect(result).toMatchObject({ status: "failed", failureReason: "The payment went through but the brief came back unreadable." });
      expect(result.trace.map((step) => step.step)).toEqual(["requirements", "guardrails", "signed", "settled"]);
      expect((await desk.getSnapshot()).policy.spentCents).toBe(5);
    });
  });
});

describe("daily budget across restarts", () => {
  it("rebuilds today's spend from the persisted log so a restart cannot reset the cap", async () => {
    const fs = createMemoryFileSystem();
    const store = await openDecisionLog({ fs, path: "/d/log.json" });
    const first = fixture({ dailyCap: 10, extra: { initialLog: store.initialLog, saveLog: store.saveLog } });
    await first.desk.buyDeepDive("GEMI-A-ONE", ORIGIN);
    await first.desk.buyDeepDive("GEMI-B-TWO", ORIGIN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = await openDecisionLog({ fs, path: "/d/log.json" });
    const restarted = fixture({ dailyCap: 10, extra: { initialLog: reopened.initialLog, saveLog: reopened.saveLog } });
    expect((await restarted.desk.getSnapshot()).policy).toMatchObject({ spentCents: 10, remainingCents: 0, researchSpentCents: 10 });
    expect(await restarted.desk.buyDeepDive("GEMI-C-THREE", ORIGIN)).toMatchObject({ status: "refused" });
    expect(restarted.signPayment).not.toHaveBeenCalled();
  });

  it("counts yesterday's spend only for yesterday", async () => {
    const fs = createMemoryFileSystem();
    const store = await openDecisionLog({ fs, path: "/d/log.json" });
    const first = fixture({ extra: { initialLog: store.initialLog, saveLog: store.saveLog } });
    await first.desk.buyDeepDive(SYMBOL, ORIGIN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = await openDecisionLog({ fs, path: "/d/log.json" });
    const nextDay = fixture({ start: Date.parse("2026-11-18T00:00:01Z"), extra: { initialLog: reopened.initialLog, saveLog: reopened.saveLog } });
    expect((await nextDay.desk.getSnapshot()).policy).toMatchObject({ spentCents: 0, remainingCents: 2000, researchSpentCents: 0 });
  });
});
