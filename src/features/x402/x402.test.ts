import { createTransferCheckedInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import { createNonceCodec, paymentMemo } from "./nonce";
import { createX402Server } from "./server";
import type { SettlementConnection } from "./server";
import { encodeHeader, paymentHeaderFor } from "./schema";
import { createUsedPayments, openUsedPayments } from "./store";

const memoProgram = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const mint = Keypair.generate().publicKey;
const payTo = Keypair.generate().publicKey;
const payer = Keypair.generate();
const symbol = "GEMI-FED261211-MAINTAIN";
const otherSymbol = "GEMI-FED261211-CUT25";
const price = 50_000n;
const startMs = 1_800_000_000_000;
const blockhash = Keypair.generate().publicKey.toBase58();
const payerAta = getAssociatedTokenAddressSync(mint, payer.publicKey);
const payToAta = getAssociatedTokenAddressSync(mint, payTo);

interface PaymentOverrides {
  readonly mint?: PublicKey;
  readonly amount?: bigint;
  readonly decimals?: number;
  readonly destination?: PublicKey;
  readonly memo?: string | null;
  readonly extra?: readonly TransactionInstruction[];
  readonly signer?: Keypair;
  readonly unsigned?: boolean;
}

function buildPayment(nonce: string, overrides: PaymentOverrides = {}): string {
  const transaction = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight: 1000 });
  transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }));
  transaction.add(
    createTransferCheckedInstruction(
      payerAta,
      overrides.mint ?? mint,
      overrides.destination ?? payToAta,
      payer.publicKey,
      overrides.amount ?? price,
      overrides.decimals ?? 6,
    ),
  );
  if (overrides.memo !== null) {
    transaction.add(new TransactionInstruction({ programId: memoProgram, keys: [], data: Buffer.from(overrides.memo ?? paymentMemo(symbol, nonce)) }));
  }
  if (overrides.extra) transaction.add(...overrides.extra);
  if (overrides.unsigned) return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  transaction.sign(overrides.signer ?? payer);
  return transaction.serialize().toString("base64");
}

function paymentSignature(transactionBase64: string): string {
  const signature = Transaction.from(Buffer.from(transactionBase64, "base64")).signature;
  if (!signature) throw new Error("unsigned");
  return bs58.encode(signature);
}

function balances(owner: PublicKey, amount: string) {
  return [{ accountIndex: 1, mint: mint.toBase58(), owner: owner.toBase58(), uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: "" } }];
}

function fixture(options: { simulateError?: unknown; confirmError?: unknown; paid?: bigint; parsedMissing?: boolean } = {}) {
  let nowMs = startMs;
  let counter = 0;
  const connection = {
    getGenesisHash: vi.fn(() => Promise.resolve(Keypair.generate().publicKey.toBase58())),
    simulateTransaction: vi.fn(() => Promise.resolve({ context: { slot: 1 }, value: { err: options.simulateError ?? null, logs: [], accounts: null, unitsConsumed: 0, returnData: null } })),
    sendRawTransaction: vi.fn((raw: Buffer) => Promise.resolve(paymentSignature(raw.toString("base64")))),
    getBlockHeight: vi.fn(() => Promise.resolve(500)),
    confirmTransaction: vi.fn(() => Promise.resolve({ context: { slot: 2 }, value: { err: options.confirmError ?? null } })),
    getParsedTransaction: vi.fn(() =>
      Promise.resolve(
        options.parsedMissing
          ? null
          : { meta: { err: null, preTokenBalances: balances(payTo, "1000000"), postTokenBalances: balances(payTo, String(1_000_000n + (options.paid ?? price))) } },
      ),
    ),
  };
  const persist = vi.fn(() => Promise.resolve());
  const used = createUsedPayments([], persist);
  const nonces = createNonceCodec({ secret: "test-secret-test-secret", ttlMs: 120_000, randomHex: () => `r${String(++counter)}` });
  const server = createX402Server({
    config: { network: "solana-localnet", mint, payTo, priceBaseUnits: price, maxTimeoutSeconds: 120, mimeType: "application/json" },
    connection: connection as unknown as SettlementConnection,
    used,
    nonces,
    nowMs: () => nowMs,
    sleep: () => Promise.resolve(),
  });
  const nonce = () => {
    const [requirement] = server.requirements(symbol, "http://desk.test/api/research/x/deep", "d", "e").accepts;
    if (!requirement) throw new Error("no requirement");
    return requirement.extra.nonce;
  };
  const header = (transaction: string, network: "solana-localnet" | "solana-devnet" = "solana-localnet") => paymentHeaderFor(network, transaction);
  return {
    server, connection, persist, nonce, header, nonces,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("payment requirements", () => {
  it("quotes the configured price, mint, recipient and a memo binding a fresh nonce to the symbol", () => {
    const { server } = fixture();
    const required = server.requirements(symbol, "http://desk.test/api/research/s/deep", "Deep dive", "payment_required");
    expect(required).toMatchObject({
      x402Version: 1,
      error: "payment_required",
      accepts: [{
        scheme: "exact", network: "solana-localnet", maxAmountRequired: "50000", asset: mint.toBase58(), payTo: payTo.toBase58(),
        resource: "http://desk.test/api/research/s/deep", mimeType: "application/json", maxTimeoutSeconds: 120,
      }],
    });
    const [requirement] = required.accepts;
    expect(requirement?.extra.memo).toBe(paymentMemo(symbol, requirement?.extra.nonce ?? ""));
    const second = server.requirements(symbol, "u", "d", "e").accepts[0]?.extra.nonce;
    expect(second).not.toBe(requirement?.extra.nonce);
  });
});

describe("verify and settle", () => {
  async function pay(f: ReturnType<typeof fixture>, transaction: string, forSymbol = symbol) {
    const verified = await f.server.verify(f.header(transaction), forSymbol);
    if (!verified.ok) return verified;
    return f.server.settle(verified.value);
  }

  it("accepts a valid payment, submits it, confirms it and reports the receipt", async () => {
    const f = fixture();
    const transaction = buildPayment(f.nonce());
    const result = await pay(f, transaction);
    expect(result).toEqual({ ok: true, value: { signature: paymentSignature(transaction), payer: payer.publicKey.toBase58(), network: "solana-localnet" } });
    expect(f.connection.simulateTransaction).toHaveBeenCalledOnce();
    expect(f.connection.sendRawTransaction).toHaveBeenCalledOnce();
    expect(f.connection.confirmTransaction).toHaveBeenCalledWith(expect.objectContaining({ signature: paymentSignature(transaction), blockhash }), "confirmed");
    expect(f.persist).toHaveBeenCalledOnce();
  });

  it.each([
    ["wrong mint", { mint: Keypair.generate().publicKey }, "wrong_mint"],
    ["underpayment", { amount: price - 1n }, "wrong_amount"],
    ["overpayment", { amount: price + 1n }, "wrong_amount"],
    ["wrong recipient", { destination: getAssociatedTokenAddressSync(mint, Keypair.generate().publicKey) }, "wrong_recipient"],
    ["wrong decimals", { decimals: 9 }, "wrong_decimals"],
    ["missing memo", { memo: null }, "memo_mismatch"],
    ["unparseable memo", { memo: "pay me" }, "memo_mismatch"],
  ] as const)("rejects %s before submitting anything", async (_name, overrides, expected) => {
    const f = fixture();
    const result = await pay(f, buildPayment(f.nonce(), overrides));
    expect(result).toEqual({ ok: false, error: expected });
    expect(f.connection.sendRawTransaction).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
  });

  it("rejects a memo naming a different symbol than the one requested", async () => {
    const f = fixture();
    const nonce = f.nonce();
    const result = await pay(f, buildPayment(nonce, { memo: paymentMemo(otherSymbol, nonce) }));
    expect(result).toEqual({ ok: false, error: "memo_mismatch" });
  });

  it("rejects a nonce that was issued for a different symbol", async () => {
    const f = fixture();
    const foreign = f.nonces.issue(otherSymbol, startMs);
    const result = await pay(f, buildPayment(foreign, { memo: paymentMemo(symbol, foreign) }));
    expect(result).toEqual({ ok: false, error: "nonce_invalid" });
  });

  it("rejects a forged nonce", async () => {
    const f = fixture();
    const result = await pay(f, buildPayment(`${String(startMs + 60_000)}.abc.${"0".repeat(32)}`, { memo: paymentMemo(symbol, `${String(startMs + 60_000)}.abc.${"0".repeat(32)}`) }));
    expect(result).toEqual({ ok: false, error: "nonce_invalid" });
  });

  it("rejects an expired nonce", async () => {
    const f = fixture();
    const transaction = buildPayment(f.nonce());
    f.advance(120_001);
    expect(await pay(f, transaction)).toEqual({ ok: false, error: "expired" });
    expect(f.connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("rejects a second payment that reuses the nonce, even with a different signature", async () => {
    const f = fixture();
    const nonce = f.nonce();
    expect(await pay(f, buildPayment(nonce))).toMatchObject({ ok: true });
    const again = buildPayment(nonce, { extra: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5 })] });
    expect(await pay(f, again)).toEqual({ ok: false, error: "nonce_reused" });
    expect(f.connection.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("rejects replaying the exact same payment", async () => {
    const f = fixture();
    const transaction = buildPayment(f.nonce());
    expect(await pay(f, transaction)).toMatchObject({ ok: true });
    expect((await pay(f, transaction)).ok).toBe(false);
    expect(f.connection.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("rejects a payment with an extra transfer instruction", async () => {
    const f = fixture();
    const sneaky = createTransferInstruction(payerAta, getAssociatedTokenAddressSync(mint, Keypair.generate().publicKey), payer.publicKey, 1n);
    expect(await pay(f, buildPayment(f.nonce(), { extra: [sneaky] }))).toEqual({ ok: false, error: "unexpected_instruction" });
  });

  it("rejects a second checked transfer and any unknown program", async () => {
    const f = fixture();
    const second = createTransferCheckedInstruction(payerAta, mint, payToAta, payer.publicKey, 1n, 6);
    expect(await pay(f, buildPayment(f.nonce(), { extra: [second] }))).toEqual({ ok: false, error: "unexpected_instruction" });
    const stranger = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) });
    expect(await pay(f, buildPayment(f.nonce(), { extra: [stranger] }))).toEqual({ ok: false, error: "unexpected_instruction" });
  });

  it("rejects a transaction without any token transfer", async () => {
    const f = fixture();
    const transaction = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight: 1 }).add(
      new TransactionInstruction({ programId: memoProgram, keys: [], data: Buffer.from(paymentMemo(symbol, f.nonce())) }),
    );
    transaction.sign(payer);
    expect(await pay(f, transaction.serialize().toString("base64"))).toEqual({ ok: false, error: "missing_transfer" });
  });

  it("rejects unsigned transactions and signatures from the wrong key", async () => {
    const f = fixture();
    expect(await pay(f, buildPayment(f.nonce(), { unsigned: true }))).toEqual({ ok: false, error: "wrong_payer" });
    const forged = Transaction.from(Buffer.from(buildPayment(f.nonce()), "base64"));
    forged.signatures[0] = { publicKey: payer.publicKey, signature: Buffer.alloc(64, 7) };
    expect(await pay(f, forged.serialize({ verifySignatures: false }).toString("base64"))).toEqual({ ok: false, error: "invalid_signature" });
  });

  it("rejects malformed headers and payloads", async () => {
    const f = fixture();
    for (const header of ["", "not base64 json", Buffer.from("{}").toString("base64"), Buffer.from("[]").toString("base64")]) {
      expect(await f.server.verify(header, symbol)).toEqual({ ok: false, error: "invalid_header" });
    }
    expect(await f.server.verify(f.header("AAAA"), symbol)).toEqual({ ok: false, error: "invalid_transaction" });
    expect(await f.server.verify(encodeHeader({ x402Version: 1, scheme: "exact", network: "solana-localnet", payload: { transaction: "" } }), symbol)).toEqual({ ok: false, error: "invalid_header" });
  });

  it("rejects a payment made for another network", async () => {
    const f = fixture();
    const verified = await f.server.verify(f.header(buildPayment(f.nonce()), "solana-devnet"), symbol);
    expect(verified).toEqual({ ok: false, error: "wrong_network" });
  });

  it("rejects when simulation fails and never submits", async () => {
    const f = fixture({ simulateError: { InstructionError: [1, "Custom"] } });
    expect(await pay(f, buildPayment(f.nonce()))).toEqual({ ok: false, error: "simulation_failed" });
    expect(f.connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("reports settlement_failed when the confirmed transaction errored, and keeps the nonce burned", async () => {
    const f = fixture({ confirmError: { InstructionError: [1, "Custom"] } });
    const nonce = f.nonce();
    expect(await pay(f, buildPayment(nonce))).toEqual({ ok: false, error: "settlement_failed" });
    expect(await pay(f, buildPayment(nonce))).toEqual({ ok: false, error: "nonce_reused" });
  });

  it("rejects settlement when the recipient's balance did not rise by exactly the price", async () => {
    const f = fixture({ paid: price - 1n });
    expect(await pay(f, buildPayment(f.nonce()))).toEqual({ ok: false, error: "settlement_mismatch" });
  });

  it("rejects settlement when the confirmed transaction cannot be read back", async () => {
    const f = fixture({ parsedMissing: true });
    expect(await pay(f, buildPayment(f.nonce()))).toEqual({ ok: false, error: "settlement_mismatch" });
  });

  it("refuses to submit when the claim cannot be persisted", async () => {
    const f = fixture();
    f.persist.mockRejectedValueOnce(new Error("disk full"));
    expect(await pay(f, buildPayment(f.nonce()))).toEqual({ ok: false, error: "store_unavailable" });
    expect(f.connection.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("lets only one of two concurrent settlements of the same nonce through", async () => {
    const f = fixture();
    const nonce = f.nonce();
    const first = await f.server.verify(f.header(buildPayment(nonce)), symbol);
    const second = await f.server.verify(f.header(buildPayment(nonce, { extra: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 })] })), symbol);
    if (!first.ok || !second.ok) throw new Error("both should pass verification");
    const results = await Promise.all([f.server.settle(first.value), f.server.settle(second.value)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(f.connection.sendRawTransaction).toHaveBeenCalledOnce();
  });
});

describe("used payment store", () => {
  it("flags a signature that was already used under any nonce", () => {
    const store = createUsedPayments([{ nonce: "old", signature: "sig", atMs: startMs }], () => Promise.resolve());
    expect(store.reuse("fresh", "sig")).toBe("signature_reused");
    expect(store.reuse("old", "other")).toBe("nonce_reused");
    expect(store.reuse("fresh", "other")).toBeUndefined();
  });

  it("survives a restart so a replay is still rejected", async () => {
    const fs = createMemoryFileSystem();
    const first = await openUsedPayments({ fs, path: "used.json" });
    expect(await first.claim("nonce-1", "sig-1", startMs)).toBeUndefined();
    const restarted = await openUsedPayments({ fs, path: "used.json" });
    expect(restarted.reuse("nonce-1", "other")).toBe("nonce_reused");
    expect(await restarted.claim("nonce-2", "sig-1", startMs)).toBe("signature_reused");
  });
});

describe("nonce codec", () => {
  const codec = createNonceCodec({ secret: "another-secret-value", ttlMs: 1000, randomHex: () => "ab12" });

  it("accepts its own nonce for the same symbol until it expires", () => {
    const nonce = codec.issue(symbol, 5000);
    expect(codec.check(nonce, symbol, 5999)).toBe("ok");
    expect(codec.check(nonce, symbol, 6000)).toBe("expired");
  });

  it("rejects other symbols, other secrets and tampering", () => {
    const nonce = codec.issue(symbol, 5000);
    expect(codec.check(nonce, otherSymbol, 5100)).toBe("nonce_invalid");
    expect(createNonceCodec({ secret: "different-secret-value", ttlMs: 1000, randomHex: () => "ab12" }).check(nonce, symbol, 5100)).toBe("nonce_invalid");
    expect(codec.check(nonce.replace("6000", "9000"), symbol, 5100)).toBe("nonce_invalid");
    expect(codec.check("garbage", symbol, 5100)).toBe("nonce_invalid");
  });
});
