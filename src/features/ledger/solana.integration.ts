import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { expect, it } from "vitest";
import { usdCents } from "@/shared";
import { createSolanaLedger } from "./index";

it("debits 2 of 20 test USDC on localnet and records the trade memo", async () => {
  const network = { cluster: "localnet", rpcUrl: "http://127.0.0.1:8899" } as const;
  const connection = new Connection(network.rpcUrl, "confirmed");
  const authority = Keypair.generate();
  const recipient = Keypair.generate();
  const directory = await mkdtemp(join(tmpdir(), "ntd-ledger-"));
  try {
    const keypairPath = join(directory, "authority.json");
    await Promise.all([
      writeFile(keypairPath, JSON.stringify(Array.from(authority.secretKey)), { mode: 0o600 }),
      writeFile(join(directory, "recipient.json"), JSON.stringify(Array.from(recipient.secretKey)), { mode: 0o600 }),
    ]);
    const block = await connection.getLatestBlockhash();
    const signature = await connection.requestAirdrop(authority.publicKey, LAMPORTS_PER_SOL);
    expect((await connection.confirmTransaction({ ...block, signature }, "confirmed")).value.err).toBeNull();

    const mint = await createMint(connection, authority, authority.publicKey, null, 6);
    const source = await getOrCreateAssociatedTokenAccount(connection, authority, mint, authority.publicKey);
    const destination = await getOrCreateAssociatedTokenAccount(connection, authority, mint, recipient.publicKey);
    await mintTo(connection, authority, mint, source.address, authority, 20_000_000n);

    const ledger = await createSolanaLedger({ network, mint, testMint: mint, recipient: recipient.publicKey, keypairPath });
    expect(await ledger.balance()).toEqual({ ok: true, value: { baseUnits: 20_000_000n } });
    const memo = "local-trade|RATE-DEC|yes|200";
    const debit = await ledger.debit("local-trade", usdCents(200), memo);
    if (!debit.ok) throw new Error(debit.error.code);
    expect(await ledger.balance()).toEqual({ ok: true, value: { baseUnits: 18_000_000n } });
    expect((await getAccount(connection, destination.address, "confirmed")).amount).toBe(2_000_000n);

    const transaction = await connection.getParsedTransaction(debit.value.signature, {
      commitment: "confirmed", maxSupportedTransactionVersion: 0,
    });
    expect(transaction?.meta?.err).toBeNull();
    expect(transaction?.transaction.message.instructions).toContainEqual({
      program: "spl-memo",
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      parsed: memo,
      stackHeight: 1,
    });
    const explorer = new URL(debit.value.explorerUrl);
    expect(explorer.origin).toBe("https://explorer.solana.com");
    expect(explorer.pathname).toBe(`/tx/${debit.value.signature}`);
    expect(explorer.searchParams.get("cluster")).toBe("custom");
    expect(explorer.searchParams.get("customUrl")).toBe(network.rpcUrl);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
