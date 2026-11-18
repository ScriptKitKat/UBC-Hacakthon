import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import type { UsdCents } from "@/shared";
import { loadKeypair } from "./keypair";

const memoProgram = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const usdcDecimals = 6;
const baseUnitsPerCent = 10_000n;
const commitment = "confirmed";

type Result<Value, Error> = { ok: true; value: Value } | { ok: false; error: Error };

export interface DebitReceipt {
  readonly signature: string;
  readonly explorerUrl: string;
}

export type LedgerError =
  | {
      readonly code: "invalid-notional" | "debit-preparation-failed" | "debit-rejected" | "balance-failed" | "ledger-not-configured";
    }
  | { readonly code: "debit-unconfirmed"; readonly signature: string };

export interface UsdcLedger {
  debit(intentId: string, notional: UsdCents, memo: string): Promise<Result<DebitReceipt, LedgerError>>;
  balance(): Promise<Result<{ baseUnits: bigint }, LedgerError>>;
}

export interface ConfiguredLedger extends UsdcLedger {
  readonly authority: string;
}

export function createUnconfiguredLedger(): UsdcLedger {
  const notConfigured = { ok: false, error: { code: "ledger-not-configured" } } as const;
  return {
    debit: () => Promise.resolve(notConfigured),
    balance: () => Promise.resolve(notConfigured),
  };
}

export type LedgerNetwork =
  | { readonly cluster: "devnet"; readonly rpcUrl?: string }
  | { readonly cluster: "localnet"; readonly rpcUrl: string };

interface LedgerConfig {
  readonly network: LedgerNetwork;
  readonly mint: PublicKey;
  readonly recipient: PublicKey;
  readonly keypairPath?: string;
}

export function explorerUrl(signature: string, network: LedgerNetwork): string {
  const url = new URL(`https://explorer.solana.com/tx/${encodeURIComponent(signature)}`);
  url.searchParams.set("cluster", network.cluster === "localnet" ? "custom" : "devnet");
  if (network.cluster === "localnet") url.searchParams.set("customUrl", network.rpcUrl);
  return url.href;
}

export async function createSolanaLedger(config: LedgerConfig): Promise<ConfiguredLedger> {
  const keypairPath = config.keypairPath ?? process.env.SOLANA_KEYPAIR_PATH;
  if (!keypairPath) throw new Error("SOLANA_KEYPAIR_PATH is required");
  const authority = await loadKeypair(keypairPath);
  const { mint, network, recipient } = config;
  const connection = new Connection(network.rpcUrl ?? "https://api.devnet.solana.com", commitment);
  const source = getAssociatedTokenAddressSync(mint, authority.publicKey);
  const destination = getAssociatedTokenAddressSync(mint, recipient);
  if (source.equals(destination)) throw new Error("Ledger recipient must differ from the authority");

  return {
    authority: authority.publicKey.toBase58(),
    async balance() {
      try {
        const { value } = await connection.getTokenAccountBalance(source, commitment);
        return { ok: true, value: { baseUnits: BigInt(value.amount) } };
      } catch {
        return { ok: false, error: { code: "balance-failed" } };
      }
    },
    async debit(intentId, notional, memo) {
      if (!Number.isSafeInteger(notional) || notional <= 0) {
        return { ok: false, error: { code: "invalid-notional" } };
      }
      if (!memo.startsWith(`${intentId}|`) || !memo.endsWith(`|${String(notional)}`)) {
        return { ok: false, error: { code: "debit-preparation-failed" } };
      }

      let signedDebit;
      try {
        const block = await connection.getLatestBlockhash(commitment);
        const transaction = new Transaction({
          feePayer: authority.publicKey,
          blockhash: block.blockhash,
          lastValidBlockHeight: block.lastValidBlockHeight,
        }).add(
          createTransferCheckedInstruction(source, mint, destination, authority.publicKey, BigInt(notional) * baseUnitsPerCent, usdcDecimals),
          new TransactionInstruction({ programId: memoProgram, keys: [], data: Buffer.from(memo, "utf8") }),
        );
        transaction.sign(authority);
        if (!transaction.signature) return { ok: false, error: { code: "debit-preparation-failed" } };
        signedDebit = { ...block, signature: bs58.encode(transaction.signature), bytes: transaction.serialize() };
      } catch {
        return { ok: false, error: { code: "debit-preparation-failed" } };
      }

      const { bytes, ...confirmation } = signedDebit;
      try {
        await connection.sendRawTransaction(bytes, { preflightCommitment: commitment });
        const { value } = await connection.confirmTransaction(confirmation, commitment);
        if (value.err) return { ok: false, error: { code: "debit-rejected" } };
        return {
          ok: true,
          value: { signature: confirmation.signature, explorerUrl: explorerUrl(confirmation.signature, network) },
        };
      } catch {
        return { ok: false, error: { code: "debit-unconfirmed", signature: confirmation.signature } };
      }
    },
  };
}
