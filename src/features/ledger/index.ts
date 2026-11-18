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
const devnetGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const mainnetGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const testnetGenesis = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const circleDevnetMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const commitment = "confirmed";

type Result<Value, Error> = { ok: true; value: Value } | { ok: false; error: Error };

export interface DebitReceipt {
  readonly signature: string;
  readonly explorerUrl: string;
}

export type LedgerError =
  | {
      readonly code: "unsafe-ledger-network" | "invalid-notional" | "debit-preparation-failed" | "debit-rejected" | "balance-failed" | "ledger-not-configured";
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
  readonly testMint?: PublicKey;
  readonly recipient: PublicKey;
  readonly keypairPath?: string;
}

function localhostOrigin(rpcUrl: string): string | undefined {
  const url = URL.parse(rpcUrl);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return undefined;
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" ? url.origin : undefined;
}

export function isLocalLedgerRpc(rpcUrl: string): boolean {
  return localhostOrigin(rpcUrl) !== undefined;
}

async function hasExpectedGenesis(network: LedgerNetwork, connection: Pick<Connection, "getGenesisHash">): Promise<boolean> {
  const hash = await connection.getGenesisHash();
  if (network.cluster === "devnet") return hash === devnetGenesis;
  return hash !== mainnetGenesis && hash !== devnetGenesis && hash !== testnetGenesis;
}

export function explorerUrl(signature: string, network: LedgerNetwork): string {
  const url = new URL(`https://explorer.solana.com/tx/${encodeURIComponent(signature)}`);
  const localOrigin = network.cluster === "localnet" ? localhostOrigin(network.rpcUrl) : undefined;
  if (network.cluster === "devnet") url.searchParams.set("cluster", "devnet");
  if (localOrigin) {
    url.searchParams.set("cluster", "custom");
    url.searchParams.set("customUrl", localOrigin);
  }
  return url.href;
}

export async function createSolanaLedger(config: LedgerConfig): Promise<ConfiguredLedger> {
  const { mint, recipient, testMint } = config;
  const network = { ...config.network };
  if (network.cluster === "localnet" && !isLocalLedgerRpc(network.rpcUrl)) {
    throw new Error("Localnet requires a localhost RPC endpoint");
  }
  if (!mint.equals(circleDevnetMint) && !(testMint && mint.equals(testMint))) {
    throw new Error("Ledger mint is not approved for testing");
  }
  const keypairPath = config.keypairPath ?? process.env.SOLANA_KEYPAIR_PATH;
  if (!keypairPath) throw new Error("SOLANA_KEYPAIR_PATH is required");
  const authority = await loadKeypair(keypairPath);
  const connection = new Connection(network.rpcUrl ?? "https://api.devnet.solana.com", {
    commitment,
    fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
  });
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
        if (!await hasExpectedGenesis(network, connection)) {
          return { ok: false, error: { code: "unsafe-ledger-network" } };
        }
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
