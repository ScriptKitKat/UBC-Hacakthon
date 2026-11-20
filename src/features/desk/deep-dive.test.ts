import { describe, expect, it, vi } from "vitest";
import { createPolicy } from "@/features/guardrails";
import { openSpendJournal } from "@/features/journal";
import type { SpendJournal } from "@/features/journal";
import type { UsdcLedger } from "@/features/ledger";
import { fail } from "@/features/markets";
import type { GeminiMarketsClient } from "@/features/markets";
import { createMemoryFileSystem } from "@/features/storage";
import { PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER, encodeHeader } from "@/features/x402";
import { usdCents } from "@/shared";
import type { LedgerView, ResearchBrief } from "@/shared";
import type { DeepDiveResource } from "./deep-dive-resource";
import { createDesk } from "./desk";
import type { DeskDeps } from "./desk";
import { openPurchaseStore } from "./purchase-store";

const SYMBOL = "GEMI-FED261211-MAINTAIN";
const ORIGIN = "http://desk.canonical.test";
const MINT = "Mint1111111111111111111111111111111111111111";
const RECIPIENT = "Recipient111111111111111111111111111111111";
const AUTHORITY = "Authority11111111111111111111111111111111";

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
  readonly recovered?: ResearchBrief | undefined;
  readonly onPaid?: () => void;
}

function fixture(options: { noResearch?: boolean; dailyCap?: number; killSwitch?: boolean; script?: Script; extra?: Partial<DeskDeps>; start?: number; noncePrefix?: string } = {}) {
  let nonceCounter = 0;
  const script = options.script ?? {};
  const dailyCap = options.dailyCap ?? 2000;
  const signature = script.signature ?? "sig-1";
  const signPayment = vi.fn<UsdcLedger["signPayment"]>(() =>
    Promise.resolve({ ok: true, value: { signature, blockhash: "hash-1", lastValidBlockHeight: 123, transaction: "dHg=", payer: AUTHORITY, explorerUrl: `https://explorer.test/tx/${signature}` } }),
  );
  const checkSignature = vi.fn<UsdcLedger["checkSignature"]>(() => Promise.resolve("pending"));
  const handle = vi.fn<DeepDiveResource["handle"]>((request, requestedSymbol) => {
    const paying = request.headers.has(PAYMENT_HEADER);
    if (!paying) {
      nonceCounter += 1;
      const custom = script.requirements;
      if (custom) return Promise.resolve(typeof custom === "function" ? custom() : custom.clone());
      return Promise.resolve(Response.json(requirementsBody({ resource: `${ORIGIN}/api/research/${requestedSymbol}/deep` }, `${options.noncePrefix ?? "nonce"}-${String(nonceCounter)}`), { status: 402 }));
    }
    script.onPaid?.();
    const custom = script.paid;
    if (custom === "throw") return Promise.reject(new Error("socket hang up"));
    if (custom) return Promise.resolve(typeof custom === "function" ? custom() : custom.clone());
    return Promise.resolve(settledResponse(signature));
  });
  const recover = vi.fn<DeepDiveResource["recover"]>(() => Promise.resolve(script.recovered));
  const resource: DeepDiveResource = { urlFor: (forSymbol) => `${ORIGIN}/api/research/${forSymbol}/deep`, handle, recover };
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
    feed: { operatorId: "priscilla", grok: { apiKey: undefined, model: "m" }, claude: { apiKey: undefined, model: "claude-test" } },
    markets,
    ledger: { debit: vi.fn(), signPayment, checkSignature, balance: vi.fn() },
    ledgerView,
    now: () => new Date(clock.nowMs),
    idGen: () => `id-${String(++ids)}`,
    ...(options.noResearch ? {} : { research: { recipient: RECIPIENT, maxPriceCents: usdCents(5), resource } }),
    ...options.extra,
  });
  return { desk, handle, recover, signPayment, checkSignature, clock };
}

async function journalOn(fs: ReturnType<typeof createMemoryFileSystem>, clock: () => number): Promise<SpendJournal> {
  return openSpendJournal({ fs, path: "/d/spend-journal.json", nowIso: () => new Date(clock()).toISOString() });
}

describe("buyDeepDive", () => {
  it("walks requirements, guardrails, signing, settlement and delivery, and logs the spend", async () => {
    const { desk, handle, signPayment } = fixture();
    const result = await desk.buyDeepDive(SYMBOL);
    expect(result.status).toBe("delivered");
    expect(result.alreadyPurchased).toBe(false);
    expect(result.brief).toEqual(brief);
    expect(result.trace.map((step) => step.step)).toEqual(["requirements", "guardrails", "signed", "settled", "brief"]);
    expect(result.trace[1]).toMatchObject({ remainingCents: 1995 });
    expect(result.trace[3]).toMatchObject({ signature: "sig-1", explorerUrl: "https://explorer.test/tx/sig-1" });
    expect(signPayment).toHaveBeenCalledWith({ recipient: RECIPIENT, notional: 5, memo: `x402|${SYMBOL}|nonce-1` });
    const [, paidCall] = handle.mock.calls;
    expect(paidCall?.[0].url).toBe(`${ORIGIN}/api/research/${SYMBOL}/deep`);
    expect(paidCall?.[0].headers.get(PAYMENT_HEADER)).toBeTruthy();
    expect(paidCall?.[1]).toBe(SYMBOL);
    const snapshot = await desk.getSnapshot();
    expect(snapshot.log[0]).toMatchObject({
      kind: "approve", source: "research", outcome: null, notionalCents: 5, symbol: SYMBOL, signature: "sig-1", explorerUrl: "https://explorer.test/tx/sig-1",
    });
    expect(snapshot.policy).toMatchObject({ spentCents: 5, remainingCents: 1995, researchSpentCents: 5 });
  });

  it("never touches the network: the resource is called in process with the configured canonical url", async () => {
    const realFetch = vi.spyOn(globalThis, "fetch");
    const { desk, handle } = fixture();
    await desk.buyDeepDive(SYMBOL);
    expect(realFetch).not.toHaveBeenCalled();
    expect(handle.mock.calls.every(([request]) => request.url.startsWith(ORIGIN))).toBe(true);
    realFetch.mockRestore();
  });

  it("keeps research out of positions and reports it as research spend", async () => {
    const { desk } = fixture();
    await desk.buyDeepDive(SYMBOL);
    const positions = await desk.getPositions();
    expect(positions.positions).toEqual([]);
    expect(positions.researchSpend).toMatchObject({ todayCents: 5, purchases: [{ symbol: SYMBOL, costCents: 5, signature: "sig-1" }] });
  });

  it("does not pay again when the brief was bought in the last 15 minutes", async () => {
    const { desk, handle, signPayment, clock } = fixture();
    await desk.buyDeepDive(SYMBOL);
    clock.nowMs += 14 * 60 * 1000;
    const again = await desk.buyDeepDive(SYMBOL);
    expect(again).toMatchObject({ status: "delivered", alreadyPurchased: true, brief, purchase: { signature: "sig-1", costCents: 5 } });
    expect(signPayment).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledTimes(2);
    expect((await desk.getSnapshot()).policy.spentCents).toBe(5);
  });

  it("pays again for the same symbol after 15 minutes", async () => {
    const { desk, signPayment, clock } = fixture();
    await desk.buyDeepDive(SYMBOL);
    clock.nowMs += 15 * 60 * 1000;
    const again = await desk.buyDeepDive(SYMBOL);
    expect(again.alreadyPurchased).toBe(false);
    expect(signPayment).toHaveBeenCalledTimes(2);
    expect((await desk.getSnapshot()).policy.spentCents).toBe(10);
  });

  it("collapses concurrent purchases of the same symbol into one payment", async () => {
    const { desk, signPayment } = fixture();
    const [first, second] = await Promise.all([desk.buyDeepDive(SYMBOL), desk.buyDeepDive(SYMBOL)]);
    expect(first).toBe(second);
    expect(signPayment).toHaveBeenCalledOnce();
  });

  it("restores a bought brief after a restart so it is not bought twice", async () => {
    const fs = createMemoryFileSystem();
    const store = await openPurchaseStore({ fs, path: "/d/purchases.json" });
    const first = fixture({ extra: { initialPurchases: store.initialPurchases, savePurchases: store.savePurchases } });
    await first.desk.buyDeepDive(SYMBOL);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reopened = await openPurchaseStore({ fs, path: "/d/purchases.json" });
    const second = fixture({ extra: { initialPurchases: reopened.initialPurchases, savePurchases: reopened.savePurchases } });
    expect(await second.desk.buyDeepDive(SYMBOL)).toMatchObject({ alreadyPurchased: true, brief });
    expect(second.signPayment).not.toHaveBeenCalled();
  });

  describe("guardrail refusals", () => {
    it("refuses with the kill switch on, makes no payment, and logs it", async () => {
      const { desk, signPayment } = fixture({ killSwitch: true });
      const result = await desk.buyDeepDive(SYMBOL);
      expect(result).toMatchObject({ status: "refused", failureReason: "Trading is paused, so I did not buy research.", brief: null });
      expect(result.trace.map((step) => step.step)).toEqual(["requirements"]);
      expect(signPayment).not.toHaveBeenCalled();
      expect((await desk.getSnapshot()).log[0]).toMatchObject({ kind: "refuse", source: "research", code: "kill-switch" });
    });

    it("refuses once research has used up the budget, with a spoken reason", async () => {
      const { desk, signPayment, clock } = fixture({ dailyCap: 10 });
      await desk.buyDeepDive("GEMI-A-ONE");
      await desk.buyDeepDive("GEMI-B-TWO");
      clock.nowMs += 1000;
      const third = await desk.buyDeepDive("GEMI-C-THREE");
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
      ["a resource on another host", { resource: `http://attacker.test/api/research/${SYMBOL}/deep` }, "different resource"],
    ])("refuses to pay when asked for %s", async (_name, change, reason) => {
      const { desk, signPayment } = fixture({ script: { requirements: Response.json(requirementsBody(change), { status: 402 }) } });
      const result = await desk.buyDeepDive(SYMBOL);
      expect(result.status).toBe("failed");
      expect(result.failureReason).toContain(reason);
      expect(result.trace).toEqual([]);
      expect(signPayment).not.toHaveBeenCalled();
      expect((await desk.getSnapshot()).log).toEqual([]);
    });

    it("fails cleanly when the endpoint does not ask for payment or sends garbage", async () => {
      const free = fixture({ script: { requirements: Response.json(brief) } });
      expect((await free.desk.buyDeepDive(SYMBOL)).failureReason).toContain("didn't ask for payment");
      const garbage = fixture({ script: { requirements: Response.json({ nope: true }, { status: 402 }) } });
      expect((await garbage.desk.buyDeepDive(SYMBOL)).failureReason).toContain("couldn't read");
    });

    it("fails when the ledger or research recipient is not configured", async () => {
      const noLedger = fixture({ extra: { ledgerView: { configured: false, missing: ["X"] } } });
      expect((await noLedger.desk.buyDeepDive(SYMBOL)).failureReason).toContain("ledger isn't configured");
      const noResearch = fixture({ noResearch: true });
      expect((await noResearch.desk.buyDeepDive(SYMBOL)).failureReason).toContain("aren't configured");
    });
  });

  describe("durable spend journal", () => {
    it("writes the reservation with the signed signature and blockhash before the payment is sent", async () => {
      const fs = createMemoryFileSystem();
      const clock = { now: START };
      const journal = await journalOn(fs, () => clock.now);
      let seenBeforePayment: unknown;
      const { desk } = fixture({
        extra: { journal },
        script: {
          onPaid: () => {
            seenBeforePayment = JSON.parse(fs.files.get("/d/spend-journal.json") ?? "{}");
          },
        },
      });
      await desk.buyDeepDive(SYMBOL);
      expect(seenBeforePayment).toMatchObject({
        entries: [{ kind: "research", status: "reserved", notionalCents: 5, symbol: SYMBOL, signature: "sig-1", blockhash: "hash-1", lastValidBlockHeight: 123 }],
      });
      expect(journal.entries()).toMatchObject([{ status: "settled", signature: "sig-1" }]);
    });

    it("refuses and never signs when the reservation cannot be recorded", async () => {
      const memory = createMemoryFileSystem();
      const fs = { ...memory, writeTextAtomic: () => Promise.reject(new Error("ENOSPC")) };
      const journal = await journalOn(fs, () => START);
      const { desk, signPayment, handle } = fixture({ extra: { journal } });
      const result = await desk.buyDeepDive(SYMBOL);
      expect(result).toMatchObject({ status: "failed", failureReason: "I couldn't record the payment safely, so nothing was spent." });
      expect(signPayment).not.toHaveBeenCalled();
      expect(handle).toHaveBeenCalledTimes(1);
      expect((await desk.getSnapshot()).policy.remainingCents).toBe(2000);
    });

    it("never sends the payment when the signed signature cannot be recorded first", async () => {
      const memory = createMemoryFileSystem();
      let writes = 0;
      const fs = { ...memory, writeTextAtomic: (path: string, contents: string) => (++writes === 2 ? Promise.reject(new Error("EIO")) : memory.writeTextAtomic(path, contents)) };
      const journal = await journalOn(fs, () => START);
      const { desk, handle } = fixture({ extra: { journal } });
      const result = await desk.buyDeepDive(SYMBOL);
      expect(result.failureReason).toBe("I couldn't record the signed payment safely, so I did not send it.");
      expect(handle).toHaveBeenCalledTimes(1);
      expect((await desk.getSnapshot()).policy.remainingCents).toBe(2000);
    });

    it("rebuilds spend and unresolved reservations from the journal after a restart", async () => {
      const fs = createMemoryFileSystem();
      const first = fixture({ dailyCap: 20, extra: { journal: await journalOn(fs, () => START) } });
      await first.desk.buyDeepDive("GEMI-A-ONE");
      const held = fixture({ dailyCap: 20, noncePrefix: "held", script: { paid: "throw", signature: "sig-held" }, extra: { journal: await journalOn(fs, () => START) } });
      await held.desk.buyDeepDive("GEMI-B-TWO");
      const restarted = fixture({ dailyCap: 20, extra: { journal: await journalOn(fs, () => START) } });
      expect((await restarted.desk.getSnapshot()).policy).toMatchObject({ spentCents: 5, remainingCents: 10, researchSpentCents: 5 });
    });

    it("counts a payment as spent only after a restart finds it on chain, and releases it when the blockhash expired unlanded", async () => {
      const fs = createMemoryFileSystem();
      const held = fixture({ dailyCap: 20, script: { paid: "throw", signature: "sig-held" }, extra: { journal: await journalOn(fs, () => START) } });
      await held.desk.buyDeepDive("GEMI-B-TWO");
      const landed = fixture({ dailyCap: 20, extra: { journal: await journalOn(fs, () => START) } });
      landed.checkSignature.mockResolvedValue("landed");
      expect(await landed.desk.reconcile()).toEqual({ settled: 1, failed: 0, stillReserved: 0 });
      expect(landed.checkSignature).toHaveBeenCalledWith({ signature: "sig-held", lastValidBlockHeight: 123 });
      expect((await landed.desk.getSnapshot()).policy).toMatchObject({ spentCents: 5, remainingCents: 15 });
      expect((await landed.desk.getPositions()).researchSpend.purchases).toMatchObject([{ symbol: "GEMI-B-TWO", signature: "sig-held" }]);
    });

    it("releases a reservation once its blockhash is proven expired without landing", async () => {
      const fs = createMemoryFileSystem();
      const held = fixture({ dailyCap: 20, script: { paid: "throw" }, extra: { journal: await journalOn(fs, () => START) } });
      await held.desk.buyDeepDive(SYMBOL);
      const later = fixture({ dailyCap: 20, extra: { journal: await journalOn(fs, () => START) } });
      later.checkSignature.mockResolvedValue("failed");
      await later.desk.reconcile();
      expect((await later.desk.getSnapshot()).policy).toMatchObject({ spentCents: 0, remainingCents: 20 });
    });

    it("keeps an unresolved reservation counted when the chain cannot say yet", async () => {
      const fs = createMemoryFileSystem();
      const held = fixture({ dailyCap: 20, script: { paid: "throw" }, extra: { journal: await journalOn(fs, () => START) } });
      await held.desk.buyDeepDive(SYMBOL);
      const later = fixture({ dailyCap: 20, extra: { journal: await journalOn(fs, () => START) } });
      expect(await later.desk.reconcile()).toEqual({ settled: 0, failed: 0, stillReserved: 1 });
      expect((await later.desk.getSnapshot()).policy.remainingCents).toBe(15);
    });

    it("does not let another purchase's completion release a reservation held across midnight", async () => {
      const fs = createMemoryFileSystem();
      const clockMs = { value: Date.parse("2026-11-17T23:59:30Z") };
      const journal = await journalOn(fs, () => clockMs.value);
      const held = fixture({ dailyCap: 20, start: clockMs.value, noncePrefix: "held", script: { paid: "throw" }, extra: { journal } });
      await held.desk.buyDeepDive("GEMI-A-ONE");
      clockMs.value = Date.parse("2026-11-18T00:00:30Z");
      const next = fixture({ dailyCap: 20, start: clockMs.value, extra: { journal } });
      await next.desk.buyDeepDive("GEMI-B-TWO");
      expect((await next.desk.getSnapshot()).policy).toMatchObject({ spentCents: 5, remainingCents: 10 });
    });
  });

  describe("payment failures", () => {
    it("releases the budget when the server rejects the payment before broadcasting", async () => {
      const rejected = Response.json(requirementsBody({}, "n2", "wrong_amount"), { status: 402 });
      const { desk } = fixture({ script: { paid: rejected } });
      const result = await desk.buyDeepDive(SYMBOL);
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
      const result = await f.desk.buyDeepDive(SYMBOL);
      expect(result).toMatchObject({ status: "failed", failureReason: "I couldn't sign the payment, so nothing was spent." });
      expect((await f.desk.getSnapshot()).policy.remainingCents).toBe(2000);
    });

    it("releases the budget only when the server proves the payment did not land", async () => {
      const dropped = Response.json(requirementsBody({}, "n2", "settlement_failed"), { status: 402 });
      const { desk } = fixture({ script: { paid: dropped } });
      const result = await desk.buyDeepDive(SYMBOL);
      expect(result.failureReason).toContain("did not land");
      expect((await desk.getSnapshot()).policy).toMatchObject({ spentCents: 0, remainingCents: 2000 });
    });

    it.each(["settlement_unconfirmed", "settlement_mismatch", "nonce_reused", "signature_reused", "http_500", "something_new"])(
      "keeps the funds reserved when the server answers %s after a possible broadcast",
      async (code) => {
        const answer = Response.json(requirementsBody({}, "n2", code), { status: 402 });
        const { desk } = fixture({ script: { paid: answer } });
        await desk.buyDeepDive(SYMBOL);
        expect((await desk.getSnapshot()).policy).toMatchObject({ spentCents: 0, remainingCents: 1995 });
      },
    );

    it("keeps the funds reserved when the paid request never answers", async () => {
      const { desk } = fixture({ script: { paid: "throw" } });
      const result = await desk.buyDeepDive(SYMBOL);
      expect(result.failureReason).toContain("never heard back");
      expect((await desk.getSnapshot()).policy.remainingCents).toBe(1995);
    });

    it("refuses to pay twice for a brief whose earlier payment is still being confirmed", async () => {
      const { desk, signPayment, clock } = fixture({ script: { paid: "throw" } });
      await desk.buyDeepDive(SYMBOL);
      clock.nowMs += 60 * 1000;
      const again = await desk.buyDeepDive(SYMBOL);
      expect(again.failureReason).toContain("still being confirmed");
      expect(signPayment).toHaveBeenCalledOnce();
    });

    it.each([
      ["a receipt for another transaction", { transaction: "other" }],
      ["a receipt naming another payer", { payer: "Mallory" }],
      ["a receipt for another network", { network: "solana-devnet" }],
    ])("distrusts %s and keeps the funds reserved", async (_name, overrides) => {
      const { desk } = fixture({ script: { paid: settledResponse("sig-1", overrides) } });
      const result = await desk.buyDeepDive(SYMBOL);
      expect(result).toMatchObject({ status: "failed", brief: null });
      expect(result.failureReason).toContain("receipt didn't match");
      expect((await desk.getSnapshot()).policy).toMatchObject({ spentCents: 0, remainingCents: 1995 });
    });

    it("distrusts a 200 without a receipt header", async () => {
      const { desk } = fixture({ script: { paid: Response.json(brief) } });
      expect((await desk.buyDeepDive(SYMBOL)).status).toBe("failed");
    });
  });

  describe("a payment that settled but whose brief did not arrive", () => {
    const unreadable = () => {
      const header = encodeHeader({ success: true, transaction: "sig-1", network: "solana-localnet", payer: AUTHORITY });
      return new Response("{}", { headers: { [PAYMENT_RESPONSE_HEADER]: header } });
    };

    it("keeps the spend and the receipt", async () => {
      const { desk } = fixture({ script: { paid: unreadable } });
      const result = await desk.buyDeepDive(SYMBOL);
      expect(result).toMatchObject({ status: "failed", brief: null, purchase: { signature: "sig-1", costCents: 5 } });
      expect(result.failureReason).toContain("without paying twice");
      expect(result.trace.map((step) => step.step)).toEqual(["requirements", "guardrails", "signed", "settled"]);
      expect((await desk.getSnapshot()).policy).toMatchObject({ spentCents: 5, remainingCents: 1995 });
    });

    it("recovers the brief by signature on the next try without signing another payment", async () => {
      const { desk, signPayment, recover } = fixture({ script: { paid: unreadable, recovered: brief } });
      await desk.buyDeepDive(SYMBOL);
      const again = await desk.buyDeepDive(SYMBOL);
      expect(again).toMatchObject({ status: "delivered", alreadyPurchased: true, brief, purchase: { signature: "sig-1" } });
      expect(recover).toHaveBeenCalledWith(SYMBOL, "sig-1");
      expect(signPayment).toHaveBeenCalledOnce();
      expect((await desk.buyDeepDive(SYMBOL)).alreadyPurchased).toBe(true);
      expect(recover).toHaveBeenCalledOnce();
    });

    it("still does not pay again while the brief cannot be recovered", async () => {
      const { desk, signPayment, clock } = fixture({ script: { paid: unreadable, recovered: undefined } });
      await desk.buyDeepDive(SYMBOL);
      clock.nowMs += 2 * 60 * 60 * 1000;
      const again = await desk.buyDeepDive(SYMBOL);
      expect(again).toMatchObject({ status: "failed", brief: null, purchase: { signature: "sig-1" } });
      expect(again.failureReason).toContain("won't charge you again");
      expect(signPayment).toHaveBeenCalledOnce();
    });

    it("recovers a settled payment while reconciliation is still checking another reservation", async () => {
      const fs = createMemoryFileSystem();
      const journal = await journalOn(fs, () => START);
      const held = fixture({ script: { paid: "throw", signature: "sig-held" }, extra: { journal } });
      await held.desk.buyDeepDive(SYMBOL);
      await journal.begin({ operationId: "other", kind: "research", notionalCents: 5, symbol: "GEMI-A-ONE", outcome: null, senderId: "research-agent", source: "research" });
      await journal.attachPayment("other", { signature: "sig-other", blockhash: "hash", lastValidBlockHeight: 123, explorerUrl: "https://explorer.test/tx/sig-other" });

      const checkingOther = Promise.withResolvers<undefined>();
      const finishOther = Promise.withResolvers<"pending">();
      const desk = fixture({ script: { recovered: brief }, extra: { journal }, noncePrefix: "retry" });
      desk.checkSignature.mockImplementation(({ signature }) => {
        if (signature === "sig-held") return Promise.resolve("landed");
        checkingOther.resolve(undefined);
        return finishOther.promise;
      });
      const reconciliation = desk.desk.reconcile();
      await checkingOther.promise;
      const result = await desk.desk.buyDeepDive(SYMBOL);
      finishOther.resolve("pending");
      await reconciliation;
      expect(result).toMatchObject({ status: "delivered", alreadyPurchased: true, purchase: { signature: "sig-held" } });
      expect(desk.signPayment).not.toHaveBeenCalled();
    });

    it("recovers an undelivered brief from the journal when newer purchases fill the cache", async () => {
      const fs = createMemoryFileSystem();
      const journal = await journalOn(fs, () => START);
      const first = fixture({ script: { paid: unreadable }, extra: { journal } });
      await first.desk.buyDeepDive(SYMBOL);

      const initialPurchases = Array.from({ length: 50 }, (_, index) => ({
        symbol: `GEMI-OTHER-${String(index)}`,
        atMs: START + 60_000,
        brief: null,
        receipt: { signature: `other-${String(index)}`, explorerUrl: "https://explorer.test/", costCents: 5 },
      }));
      const restarted = fixture({ start: START + 60_000, script: { recovered: brief }, extra: { journal, initialPurchases }, noncePrefix: "retry" });
      expect(await restarted.desk.buyDeepDive(SYMBOL)).toMatchObject({
        status: "delivered", alreadyPurchased: true, purchase: { signature: "sig-1" },
      });
      expect(restarted.signPayment).not.toHaveBeenCalled();
    });

    it("can recover a payment that settled only after a restart's chain check", async () => {
      const fs = createMemoryFileSystem();
      const held = fixture({ script: { paid: "throw", signature: "sig-held" }, extra: { journal: await journalOn(fs, () => START) } });
      await held.desk.buyDeepDive(SYMBOL);
      const restarted = fixture({ script: { recovered: brief }, extra: { journal: await journalOn(fs, () => START) } });
      restarted.checkSignature.mockResolvedValue("landed");
      await restarted.desk.reconcile();
      const result = await restarted.desk.buyDeepDive(SYMBOL);
      expect(result).toMatchObject({ status: "delivered", alreadyPurchased: true, brief });
      expect(restarted.signPayment).not.toHaveBeenCalled();
    });
  });
});

describe("daily budget across restarts", () => {
  it("rebuilds today's spend from the spend journal, not the capped display log, so a restart cannot reset the cap", async () => {
    const fs = createMemoryFileSystem();
    const first = fixture({ dailyCap: 10, extra: { journal: await journalOn(fs, () => START) } });
    await first.desk.buyDeepDive("GEMI-A-ONE");
    await first.desk.buyDeepDive("GEMI-B-TWO");
    const restarted = fixture({ dailyCap: 10, extra: { journal: await journalOn(fs, () => START) } });
    expect((await restarted.desk.getSnapshot()).policy).toMatchObject({ spentCents: 10, remainingCents: 0, researchSpentCents: 10 });
    expect(await restarted.desk.buyDeepDive("GEMI-C-THREE")).toMatchObject({ status: "refused" });
    expect(restarted.signPayment).not.toHaveBeenCalled();
  });

  it("counts yesterday's spend only for yesterday", async () => {
    const fs = createMemoryFileSystem();
    const first = fixture({ extra: { journal: await journalOn(fs, () => START) } });
    await first.desk.buyDeepDive(SYMBOL);
    const nextDayMs = Date.parse("2026-11-18T00:00:01Z");
    const nextDay = fixture({ start: nextDayMs, extra: { journal: await journalOn(fs, () => nextDayMs) } });
    expect((await nextDay.desk.getSnapshot()).policy).toMatchObject({ spentCents: 0, remainingCents: 2000, researchSpentCents: 0 });
  });
});
