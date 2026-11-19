import { decodeTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usdCents } from "@/shared";
import { createSolanaLedger, explorerUrl } from "./index";
import { loadKeypair } from "./keypair";

vi.mock("./keypair", () => ({ loadKeypair: vi.fn() }));

const devnetGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const mainnetGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const devnet = { cluster: "devnet", rpcUrl: "https://rpc.example.test" } as const;
const localnet = { cluster: "localnet", rpcUrl: "http://127.0.0.1:8899" } as const;
const authority = Keypair.generate();
const config = {
  network: devnet,
  mint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
  recipient: Keypair.generate().publicKey,
  keypairPath: "test-keypair",
};

function fakeRpc(hash: string) {
  const genesis = vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(hash);
  const block = vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({
    blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 123,
  });
  const send = vi.spyOn(Connection.prototype, "sendRawTransaction").mockResolvedValue("signature");
  vi.spyOn(Connection.prototype, "confirmTransaction").mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
  const account = vi.spyOn(Connection.prototype, "getAccountInfo").mockResolvedValue({
    data: Buffer.alloc(0), executable: false, lamports: 1, owner: Keypair.generate().publicKey,
  });
  return { genesis, block, send, account };
}

beforeEach(() => vi.mocked(loadKeypair).mockResolvedValue(authority));
afterEach(() => vi.restoreAllMocks());

it.each([devnet, localnet])("rejects mainnet behind a $cluster endpoint before preparing a transaction", async (network) => {
  const rpc = fakeRpc(mainnetGenesis);
  const ledger = await createSolanaLedger({ ...config, network });
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toEqual({
    ok: false, error: { code: "unsafe-ledger-network" },
  });
  expect(rpc.block).not.toHaveBeenCalled();
  expect(rpc.send).not.toHaveBeenCalled();
});

it("requires the devnet genesis hash on devnet", async () => {
  const rpc = fakeRpc(Keypair.generate().publicKey.toBase58());
  const ledger = await createSolanaLedger(config);
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toMatchObject({
    ok: false, error: { code: "unsafe-ledger-network" },
  });
  expect(rpc.block).not.toHaveBeenCalled();
});

it.each([devnet, localnet])("refuses to debit on $cluster when the recipient token account is missing", async (network) => {
  const rpc = fakeRpc(network.cluster === "devnet" ? devnetGenesis : Keypair.generate().publicKey.toBase58());
  rpc.account.mockResolvedValue(null);
  const ledger = await createSolanaLedger({ ...config, network });
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toEqual({
    ok: false, error: { code: "recipient-ata-missing" },
  });
  expect(rpc.block).not.toHaveBeenCalled();
  expect(rpc.send).not.toHaveBeenCalled();
});

it("links devnet transactions to the devnet explorer without a custom url", () => {
  expect(explorerUrl("signature", { cluster: "devnet", rpcUrl: "https://api.devnet.solana.com" }))
    .toBe("https://explorer.solana.com/tx/signature?cluster=devnet");
});

it("rejects a remote localnet endpoint even when its URL mentions localhost", async () => {
  await expect(createSolanaLedger({ ...config, network: { cluster: "localnet", rpcUrl: "https://localhost@rpc.example.test" } }))
    .rejects.toThrow("Localnet requires a localhost RPC endpoint");
});

it.each([devnet, localnet])("requires explicit approval for a custom mint on $cluster", async (network) => {
  const mint = Keypair.generate().publicKey;
  const rpc = fakeRpc(network.cluster === "devnet" ? devnetGenesis : Keypair.generate().publicKey.toBase58());
  await expect(createSolanaLedger({ ...config, network, mint })).rejects.toThrow("Ledger mint is not approved for testing");
  const ledger = await createSolanaLedger({ ...config, network, mint, testMint: mint });
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toMatchObject({ ok: true });
  expect(rpc.genesis).toHaveBeenCalledBefore(rpc.block);
  expect(rpc.send).toHaveBeenCalledOnce();
});

it("accepts Circle devnet USDC and rechecks the network before each debit", async () => {
  const rpc = fakeRpc(devnetGenesis);
  const ledger = await createSolanaLedger(config);
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toMatchObject({ ok: true });
  rpc.genesis.mockResolvedValue(mainnetGenesis);
  expect(await ledger.debit("next", usdCents(200), "next|SYMBOL|yes|200")).toMatchObject({
    ok: false, error: { code: "unsafe-ledger-network" },
  });
  expect(rpc.send).toHaveBeenCalledOnce();
});

it("exposes only localhost origins in explorer links", () => {
  const credential = "RPC_SECRET_SENTINEL";
  const rpcUrl = `https://rpc.example.test/${credential}?key=${credential}`;
  for (const cluster of ["localnet", "devnet"] as const) {
    const url = new URL(explorerUrl("signature", { cluster, rpcUrl }));
    expect(url.searchParams.has("customUrl")).toBe(false);
    expect(url.href).not.toContain(credential);
  }
  const url = new URL(explorerUrl("signature", {
    cluster: "localnet", rpcUrl: `http://user:${credential}@localhost:8899/${credential}?key=${credential}`,
  }));
  expect(url.searchParams.get("customUrl")).toBe("http://localhost:8899");
  expect(url.href).not.toContain(credential);
});

it("maps RPC exceptions to fixed ledger errors", async () => {
  const rpc = fakeRpc(devnetGenesis);
  const secret = new Error("https://rpc.example.test/?key=RPC_SECRET_SENTINEL");
  rpc.genesis.mockRejectedValue(secret);
  vi.spyOn(Connection.prototype, "getTokenAccountBalance").mockRejectedValue(secret);
  const ledger = await createSolanaLedger(config);
  expect(await ledger.debit("trade", usdCents(200), "trade|SYMBOL|yes|200")).toEqual({
    ok: false, error: { code: "debit-preparation-failed" },
  });
  expect(await ledger.balance()).toEqual({ ok: false, error: { code: "balance-failed" } });
  expect(rpc.send).not.toHaveBeenCalled();
});

const maxCents = ((1n << 64n) - 1n) / 10_000n;

it.each([1n, maxCents])("encodes %s cents exactly as token base units", async (cents) => {
  const rpc = fakeRpc(devnetGenesis);
  const ledger = await createSolanaLedger(config);
  expect(await ledger.debit("trade", usdCents(Number(cents)), `trade|SYMBOL|yes|${String(cents)}`)).toMatchObject({ ok: true });
  const bytes = rpc.send.mock.calls[0]?.[0];
  if (!bytes) throw new Error("Expected signed transaction");
  const [transfer] = Transaction.from(bytes).instructions;
  if (!transfer) throw new Error("Expected transfer instruction");
  expect(decodeTransferCheckedInstruction(transfer).data.amount).toBe(cents * 10_000n);
});

it("rejects the first cent amount beyond the token u64 limit", async () => {
  const rpc = fakeRpc(devnetGenesis);
  const ledger = await createSolanaLedger(config);
  const cents = maxCents + 1n;
  expect(await ledger.debit("trade", usdCents(Number(cents)), `trade|SYMBOL|yes|${String(cents)}`)).toEqual({
    ok: false, error: { code: "notional-overflow" },
  });
  expect(rpc.genesis).not.toHaveBeenCalled();
  expect(rpc.send).not.toHaveBeenCalled();
});

it.each([devnet, localnet])("signs but never sends a USDC payment with a memo on $cluster", async (network) => {
  const rpc = fakeRpc(network.cluster === "devnet" ? devnetGenesis : Keypair.generate().publicKey.toBase58());
  const ledger = await createSolanaLedger({ ...config, network });
  const payee = Keypair.generate().publicKey;
  const result = await ledger.signPayment({ recipient: payee.toBase58(), notional: usdCents(5), memo: "x402|SYMBOL|nonce" });
  if (!result.ok) throw new Error("expected a signed payment");
  expect(rpc.send).not.toHaveBeenCalled();
  expect(result.value.payer).toBe(authority.publicKey.toBase58());
  const transaction = Transaction.from(Buffer.from(result.value.transaction, "base64"));
  expect(transaction.verifySignatures()).toBe(true);
  const [transfer, memo] = transaction.instructions;
  const decoded = decodeTransferCheckedInstruction(transfer ?? (() => { throw new Error("missing transfer"); })());
  expect(decoded.data).toMatchObject({ amount: 50_000n, decimals: 6 });
  expect(decoded.keys.destination.pubkey.toBase58()).toBe(getAssociatedTokenAddressSync(config.mint, payee).toBase58());
  expect(memo?.data.toString()).toBe("x402|SYMBOL|nonce");
  expect(rpc.account).toHaveBeenCalledWith(getAssociatedTokenAddressSync(config.mint, payee), "confirmed");
});

it("refuses to sign a payment to the authority itself, to a missing token account, or on an unsafe network", async () => {
  const rpc = fakeRpc(Keypair.generate().publicKey.toBase58());
  const ledger = await createSolanaLedger({ ...config, network: localnet });
  const payment = { notional: usdCents(5), memo: "m" };
  expect(await ledger.signPayment({ ...payment, recipient: authority.publicKey.toBase58() })).toEqual({ ok: false, error: { code: "invalid-recipient" } });
  expect(await ledger.signPayment({ ...payment, recipient: "not a key" })).toEqual({ ok: false, error: { code: "invalid-recipient" } });
  rpc.account.mockResolvedValueOnce(null);
  expect(await ledger.signPayment({ ...payment, recipient: Keypair.generate().publicKey.toBase58() })).toEqual({ ok: false, error: { code: "recipient-ata-missing" } });
  rpc.genesis.mockResolvedValueOnce(mainnetGenesis);
  expect(await ledger.signPayment({ ...payment, recipient: Keypair.generate().publicKey.toBase58() })).toEqual({ ok: false, error: { code: "unsafe-ledger-network" } });
  expect(rpc.send).not.toHaveBeenCalled();
});

it("rejects a payment with no amount or no memo", async () => {
  fakeRpc(Keypair.generate().publicKey.toBase58());
  const ledger = await createSolanaLedger({ ...config, network: localnet });
  const recipient = Keypair.generate().publicKey.toBase58();
  expect(await ledger.signPayment({ recipient, notional: usdCents(0), memo: "m" })).toEqual({ ok: false, error: { code: "invalid-notional" } });
  expect(await ledger.signPayment({ recipient, notional: usdCents(5), memo: "" })).toEqual({ ok: false, error: { code: "debit-preparation-failed" } });
});
