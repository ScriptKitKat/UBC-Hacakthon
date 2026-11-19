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
const maxTokenAmount = (1n << 64n) - 1n;
const devnetGenesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const mainnetGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const testnetGenesis = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const circleDevnetMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const commitment = "confirmed";
const maxMemoBytes = 256;

function safePublicKey(text: string): PublicKey | undefined {
  try {
    return new PublicKey(text);
  } catch {
    return undefined;
  }
}

type Result<Value, Error> = { ok: true; value: Value } | { ok: false; error: Error };

export interface DebitReceipt {
  readonly signature: string;
  readonly explorerUrl: string;
}

export type LedgerError =
  | {
      readonly code: "notional-overflow" | "unsafe-ledger-network" | "invalid-notional" | "invalid-recipient" | "debit-preparation-failed" | "debit-rejected" | "balance-failed" | "ledger-not-configured" | "recipient-ata-missing";
    }
  | { readonly code: "debit-unconfirmed"; readonly signature: string };

export interface PaymentRequest {
  readonly recipient: string;
  readonly notional: UsdCents;
  readonly memo: string;
}

export interface SignedPayment {
  readonly signature: string;
  readonly transaction: string;
  readonly payer: string;
  readonly explorerUrl: string;
}

export interface UsdcLedger {
  debit(intentId: string, notional: UsdCents, memo: string): Promise<Result<DebitReceipt, LedgerError>>;
  signPayment(payment: PaymentRequest): Promise<Result<SignedPayment, LedgerError>>;
  balance(): Promise<Result<{ baseUnits: bigint }, LedgerError>>;
}

export interface ConfiguredLedger extends UsdcLedger {
  readonly authority: string;
}

export function createUnconfiguredLedger(): UsdcLedger {
  const notConfigured = { ok: false, error: { code: "ledger-not-configured" } } as const;
  return {
    debit: () => Promise.resolve(notConfigured),
    signPayment: () => Promise.resolve(notConfigured),
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

export function isExpectedGenesis(cluster: LedgerNetwork["cluster"], hash: string): boolean {
  if (cluster === "devnet") return hash === devnetGenesis;
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

  async function prepareTransfer(
    to: PublicKey,
    notional: UsdCents,
    memo: string,
  ): Promise<Result<{ readonly blockhash: string; readonly lastValidBlockHeight: number; readonly signature: string; readonly bytes: Buffer }, LedgerError>> {
    const amount = BigInt(notional) * baseUnitsPerCent;
    if (amount > maxTokenAmount) return { ok: false, error: { code: "notional-overflow" } };
    try {
      if (!isExpectedGenesis(network.cluster, await connection.getGenesisHash())) {
        return { ok: false, error: { code: "unsafe-ledger-network" } };
      }
      if (await connection.getAccountInfo(to, commitment) === null) {
        return { ok: false, error: { code: "recipient-ata-missing" } };
      }
      const block = await connection.getLatestBlockhash(commitment);
      const transaction = new Transaction({
        feePayer: authority.publicKey,
        blockhash: block.blockhash,
        lastValidBlockHeight: block.lastValidBlockHeight,
      }).add(
        createTransferCheckedInstruction(source, mint, to, authority.publicKey, amount, usdcDecimals),
        new TransactionInstruction({ programId: memoProgram, keys: [], data: Buffer.from(memo, "utf8") }),
      );
      transaction.sign(authority);
      if (!transaction.signature) return { ok: false, error: { code: "debit-preparation-failed" } };
      return { ok: true, value: { ...block, signature: bs58.encode(transaction.signature), bytes: transaction.serialize() } };
    } catch {
      return { ok: false, error: { code: "debit-preparation-failed" } };
    }
  }

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
    async signPayment({ recipient, notional, memo }) {
      if (!Number.isSafeInteger(notional) || notional <= 0) {
        return { ok: false, error: { code: "invalid-notional" } };
      }
      if (memo.length === 0 || Buffer.byteLength(memo, "utf8") > maxMemoBytes) {
        return { ok: false, error: { code: "debit-preparation-failed" } };
      }
      const payee = safePublicKey(recipient);
      if (!payee) return { ok: false, error: { code: "invalid-recipient" } };
      const payeeAta = getAssociatedTokenAddressSync(mint, payee);
      if (payeeAta.equals(source)) return { ok: false, error: { code: "invalid-recipient" } };
      const prepared = await prepareTransfer(payeeAta, notional, memo);
      if (!prepared.ok) return prepared;
      return {
        ok: true,
        value: {
          signature: prepared.value.signature,
          transaction: prepared.value.bytes.toString("base64"),
          payer: authority.publicKey.toBase58(),
          explorerUrl: explorerUrl(prepared.value.signature, network),
        },
      };
    },
    async debit(intentId, notional, memo) {
      if (!Number.isSafeInteger(notional) || notional <= 0) {
        return { ok: false, error: { code: "invalid-notional" } };
      }
      if (!memo.startsWith(`${intentId}|`) || !memo.endsWith(`|${String(notional)}`)) {
        return { ok: false, error: { code: "debit-preparation-failed" } };
      }
      const prepared = await prepareTransfer(destination, notional, memo);
      if (!prepared.ok) return prepared;
      const { bytes, ...confirmation } = prepared.value;
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
