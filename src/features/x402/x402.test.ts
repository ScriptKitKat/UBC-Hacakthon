import { AccountLayout, AccountState, TOKEN_PROGRAM_ID, createTransferCheckedInstruction, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import { createNonceCodec, paymentMemo } from "./nonce";
import type { PaymentTerms } from "./nonce";
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

function tokenAccount(owner: PublicKey) {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      mint, owner, amount: 0n, delegateOption: 0, delegate: PublicKey.default, state: AccountState.Initialized,
      isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default,
    },
    data,
  );
  return { data, executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID };
}

const termsFor = (forSymbol: string): PaymentTerms => ({
  symbol: forSymbol,
  resource: `http://desk.test/api/research/${forSymbol}/deep`,
  amount: price.toString(),
  asset: mint.toBase58(),
  payTo: payTo.toBase58(),
  network: "solana-localnet",
});

type Landing = "landed" | "failed" | "pending" | "expired";

function fixture(options: { simulateError?: unknown; landing?: Landing; paid?: bigint; parsedMissing?: boolean; destinationOwner?: PublicKey } = {}) {
  let nowMs = startMs;
  let counter = 0;
  const connection = {
    getGenesisHash: vi.fn(() => Promise.resolve(Keypair.generate().publicKey.toBase58())),
    simulateTransaction: vi.fn(() => Promise.resolve({ context: { slot: 1 }, value: { err: options.simulateError ?? null, logs: [], accounts: null, unitsConsumed: 0, returnData: null } })),
    sendRawTransaction: vi.fn((raw: Buffer) => Promise.resolve(paymentSignature(raw.toString("base64")))),
    getAccountInfo: vi.fn(() => Promise.resolve(tokenAccount(options.destinationOwner ?? payTo))),
    getLatestBlockhash: vi.fn(() => Promise.resolve({ blockhash, lastValidBlockHeight: 150 })),
    getEpochInfo: vi.fn(() => Promise.resolve({ blockHeight: options.landing === "expired" ? 151 : 150, absoluteSlot: 2 })),
    getSignatureStatuses: vi.fn(() => {
      const landing = options.landing ?? "landed";
      const status = landing === "landed"
        ? { slot: 2, confirmations: 1, err: null, confirmationStatus: "confirmed" }
        : landing === "failed" ? { slot: 2, confirmations: 1, err: { InstructionError: [1, "Custom"] }, confirmationStatus: "finalized" } : null;
      return Promise.resolve({ context: { slot: 2 }, value: [status] });
    }),
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
    config: { network: "solana-localnet", mint, payTo, priceBaseUnits: price, maxTimeoutSeconds: 120, mimeType: "application/json", resourceFor: (forSymbol) => termsFor(forSymbol).resource },
    connection: connection as unknown as SettlementConnection,
    used,
    nonces,
    nowMs: () => nowMs,
    sleep: () => Promise.resolve(),
  });
  const nonce = () => {
    const [requirement] = server.requirements(symbol, "d", "e").accepts;
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
    const required = server.requirements(symbol, "Deep dive", "payment_required");
    expect(required).toMatchObject({
      x402Version: 1,
      error: "payment_required",
      accepts: [{
        scheme: "exact", network: "solana-localnet", maxAmountRequired: "50000", asset: mint.toBase58(), payTo: payTo.toBase58(),
        resource: `http://desk.test/api/research/${symbol}/deep`, mimeType: "application/json", maxTimeoutSeconds: 120,
      }],
    });
    const [requirement] = required.accepts;
    expect(requirement?.extra.memo).toBe(paymentMemo(symbol, requirement?.extra.nonce ?? ""));
    const second = server.requirements(symbol, "d", "e").accepts[0]?.extra.nonce;
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
    expect(f.connection.getLatestBlockhash).toHaveBeenCalledWith({ commitment: "confirmed", minContextSlot: 1 });
    expect(f.connection.getEpochInfo).toHaveBeenCalledWith("finalized");
    expect(f.persist).toHaveBeenCalledTimes(2);
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
    const foreign = f.nonces.issue(termsFor(otherSymbol), startMs);
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

  it("reports settlement_failed when the transaction landed with an error, and keeps the nonce burned", async () => {
    const f = fixture({ landing: "failed" });
    const nonce = f.nonce();
    expect(await pay(f, buildPayment(nonce))).toEqual({ ok: false, error: "settlement_failed" });
    expect(await pay(f, buildPayment(nonce))).toEqual({ ok: false, error: "nonce_reused" });
  });

  it("reports settlement_failed only once the signed blockhash has actually expired without the payment landing", async () => {
    const f = fixture({ landing: "expired" });
    expect(await pay(f, buildPayment(f.nonce()))).toEqual({ ok: false, error: "settlement_failed" });
    expect(f.connection.getEpochInfo).toHaveBeenCalledWith("finalized");
  });

  it("does not use an expiry height issued for a different blockhash to reject a payment", async () => {
    const f = fixture({ landing: "expired" });
    f.connection.getLatestBlockhash.mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 150 });
    const transaction = buildPayment(f.nonce());
    expect(await pay(f, transaction)).toEqual({ ok: false, error: "settlement_unconfirmed" });
    expect(f.connection.getEpochInfo).not.toHaveBeenCalled();
    expect(await f.server.recover(symbol, paymentSignature(transaction))).toEqual({ ok: false, error: "settlement_unconfirmed" });
  });

  it("can settle a visible payment when the optional expiry lookup fails", async () => {
    const f = fixture();
    f.connection.getLatestBlockhash.mockRejectedValueOnce(new Error("RPC unavailable"));
    expect(await pay(f, buildPayment(f.nonce()))).toMatchObject({ ok: true });
  });

  it("reports settlement_unconfirmed, not failure, while the payment may still land", async () => {
    const f = fixture({ landing: "pending" });
    expect(await pay(f, buildPayment(f.nonce()))).toEqual({ ok: false, error: "settlement_unconfirmed" });
    expect(f.connection.getSignatureStatuses.mock.calls.length).toBeGreaterThan(10);
  });

  it("reports settlement_unconfirmed when the submission itself throws", async () => {
    const f = fixture();
    f.connection.sendRawTransaction.mockRejectedValueOnce(new Error("rpc down"));
    expect(await pay(f, buildPayment(f.nonce()))).toEqual({ ok: false, error: "settlement_unconfirmed" });
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

  it("refuses to broadcast when the payee's token account is no longer controlled by the payee", async () => {
    const f = fixture({ destinationOwner: Keypair.generate().publicKey });
    expect(await pay(f, buildPayment(f.nonce()))).toEqual({ ok: false, error: "wrong_recipient" });
    expect(f.connection.sendRawTransaction).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
  });

  it("refuses to broadcast when the nonce expired between verification and settlement", async () => {
    const f = fixture();
    const verified = await f.server.verify(f.header(buildPayment(f.nonce())), symbol);
    if (!verified.ok) throw new Error("should verify");
    f.advance(120_001);
    expect(await f.server.settle(verified.value)).toEqual({ ok: false, error: "expired" });
    expect(f.connection.sendRawTransaction).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
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

describe("recovering a paid brief without paying again", () => {
  async function paid(f: ReturnType<typeof fixture>) {
    const transaction = buildPayment(f.nonce());
    const verified = await f.server.verify(f.header(transaction), symbol);
    if (!verified.ok) throw new Error("should verify");
    const settled = await f.server.settle(verified.value);
    return { settled, signature: paymentSignature(transaction) };
  }

  it("returns the original receipt for a settled signature and symbol", async () => {
    const f = fixture();
    const { signature } = await paid(f);
    const sends = f.connection.sendRawTransaction.mock.calls.length;
    expect(await f.server.recover(symbol, signature)).toEqual({ ok: true, value: { signature, payer: payer.publicKey.toBase58(), network: "solana-localnet" } });
    expect(f.connection.sendRawTransaction.mock.calls.length).toBe(sends);
  });

  it("settles a claimed payment that confirmed after the first request gave up, once the chain shows it landed for exactly the price", async () => {
    const f = fixture({ landing: "pending" });
    const { settled, signature } = await paid(f);
    expect(settled).toEqual({ ok: false, error: "settlement_unconfirmed" });
    f.connection.getSignatureStatuses.mockResolvedValue({ context: { slot: 9 }, value: [{ slot: 9, confirmations: 1, err: null, confirmationStatus: "confirmed" }] });
    expect(await f.server.recover(symbol, signature)).toMatchObject({ ok: true, value: { signature } });
  });

  it("stays unconfirmed while the chain does not show the payment", async () => {
    const f = fixture({ landing: "pending" });
    const { signature } = await paid(f);
    expect(await f.server.recover(symbol, signature)).toEqual({ ok: false, error: "settlement_unconfirmed" });
  });

  it("reports a claimed payment as failed after the finalized height passes its stored limit", async () => {
    const f = fixture({ landing: "pending" });
    const { signature } = await paid(f);
    f.connection.getEpochInfo.mockResolvedValue({ blockHeight: 151, absoluteSlot: 2 });
    expect(await f.server.recover(symbol, signature)).toEqual({ ok: false, error: "settlement_failed" });
  });

  it("knows nothing about signatures it never claimed or ones claimed for another symbol", async () => {
    const f = fixture();
    const { signature } = await paid(f);
    expect(await f.server.recover(symbol, "never-seen")).toEqual({ ok: false, error: "unknown_payment" });
    expect(await f.server.recover(otherSymbol, signature)).toEqual({ ok: false, error: "unknown_payment" });
  });
});

describe("used payment store", () => {
  const claim = (nonce: string, signature: string, atMs = startMs) => ({ nonce, signature, atMs, symbol, payer: "payer", lastValidBlockHeight: 150 });

  it("flags a signature that was already used under any nonce", () => {
    const store = createUsedPayments([{ ...claim("old", "sig"), status: "claimed" }], () => Promise.resolve());
    expect(store.reuse("fresh", "sig")).toBe("signature_reused");
    expect(store.reuse("old", "other")).toBe("nonce_reused");
    expect(store.reuse("fresh", "other")).toBeUndefined();
  });

  it("survives a restart so a replay is still rejected", async () => {
    const fs = createMemoryFileSystem();
    const first = await openUsedPayments({ fs, path: "used.json" });
    expect(await first.claim(claim("nonce-1", "sig-1"))).toBeUndefined();
    const restarted = await openUsedPayments({ fs, path: "used.json" });
    expect(restarted.find("sig-1")?.lastValidBlockHeight).toBe(150);
    expect(restarted.reuse("nonce-1", "other")).toBe("nonce_reused");
    expect(await restarted.claim(claim("nonce-2", "sig-1"))).toBe("signature_reused");
  });

  it("a failed persist leaves no claim behind and never erases a later claim", async () => {
    const memory = createMemoryFileSystem();
    let writes = 0;
    const fs = {
      ...memory,
      writeTextAtomic: async (path: string, contents: string) => {
        writes += 1;
        if (writes === 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("EIO");
        }
        return memory.writeTextAtomic(path, contents);
      },
    };
    const store = await openUsedPayments({ fs, path: "used.json" });
    const first = store.claim(claim("n1", "s1"));
    const second = store.claim(claim("n2", "s2"));
    expect(await first).toBe("store_unavailable");
    expect(await second).toBeUndefined();
    expect(store.reuse("n2", "x")).toBe("nonce_reused");
    expect(store.reuse("n1", "s1")).toBeUndefined();
    expect((await openUsedPayments({ fs, path: "used.json" })).reuse("n2", "x")).toBe("nonce_reused");
  });

  it("lets exactly one of two concurrent claims for the same nonce win", async () => {
    const store = createUsedPayments([], () => Promise.resolve());
    const results = await Promise.all([store.claim(claim("n", "a")), store.claim(claim("n", "b"))]);
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
  });

  it("marks a claim settled and remembers it across a restart", async () => {
    const fs = createMemoryFileSystem();
    const store = await openUsedPayments({ fs, path: "used.json" });
    await store.claim(claim("n", "s"));
    await store.markSettled("s");
    expect((await openUsedPayments({ fs, path: "used.json" })).find("s")).toMatchObject({ status: "settled", symbol, payer: "payer" });
  });

  it("refuses to open a corrupt replay store instead of starting empty", async () => {
    const fs = createMemoryFileSystem({ "used.json": "{broken" });
    await expect(openUsedPayments({ fs, path: "used.json" })).rejects.toMatchObject({ name: "StoreUnavailableError" });
    expect([...fs.files.keys()].some((name) => name.startsWith("used.json.corrupt-"))).toBe(true);
  });
});

describe("nonce codec", () => {
  const codec = createNonceCodec({ secret: "another-secret-value", ttlMs: 1000, randomHex: () => "ab12" });

  it("accepts its own nonce for the same terms until it expires", () => {
    const nonce = codec.issue(termsFor(symbol), 5000);
    expect(codec.check(nonce, termsFor(symbol), 5999)).toBe("ok");
    expect(codec.check(nonce, termsFor(symbol), 6000)).toBe("expired");
  });

  it("rejects other symbols, other secrets and tampering", () => {
    const nonce = codec.issue(termsFor(symbol), 5000);
    expect(codec.check(nonce, termsFor(otherSymbol), 5100)).toBe("nonce_invalid");
    expect(createNonceCodec({ secret: "different-secret-value", ttlMs: 1000, randomHex: () => "ab12" }).check(nonce, termsFor(symbol), 5100)).toBe("nonce_invalid");
    expect(codec.check(nonce.replace("6000", "9000"), termsFor(symbol), 5100)).toBe("nonce_invalid");
    expect(codec.check("garbage", termsFor(symbol), 5100)).toBe("nonce_invalid");
  });

  it.each([
    ["resource", { resource: "http://other.test/api/research/x/deep" }],
    ["amount", { amount: "50001" }],
    ["asset", { asset: Keypair.generate().publicKey.toBase58() }],
    ["payTo", { payTo: Keypair.generate().publicKey.toBase58() }],
    ["network", { network: "solana-devnet" }],
  ] as const)("binds the nonce to the %s so another deployment sharing the secret cannot accept it", (_field, change) => {
    const nonce = codec.issue(termsFor(symbol), 5000);
    expect(codec.check(nonce, { ...termsFor(symbol), ...change }, 5100)).toBe("nonce_invalid");
  });
});
