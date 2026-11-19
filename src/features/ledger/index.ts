import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
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
      readonly code: "notional-overflow" | "unsafe-ledger-network" | "invalid-notional" | "invalid-recipient" | "debit-preparation-failed" | "debit-rejected" | "balance-failed" | "ledger-not-configured" | "recipient-ata-missing" | "destination-invalid" | "pre-broadcast-failed";
    }
  | { readonly code: "debit-unconfirmed"; readonly signature: string };

export interface PaymentRequest {
  readonly recipient: string;
  readonly notional: UsdCents;
  readonly memo: string;
}

export interface SignedPayment {
  readonly signature: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
  readonly transaction: string;
  readonly payer: string;
  readonly explorerUrl: string;
}

export interface PreparedPayment {
  readonly signature: string;
  readonly blockhash: string;
  readonly lastValidBlockHeight: number;
  readonly explorerUrl: string;
}

export type BeforeBroadcast = (payment: PreparedPayment) => Promise<boolean>;

export type SignatureOutcome = "landed" | "failed" | "pending";

export interface PaymentToCheck {
  readonly signature: string;
  readonly lastValidBlockHeight: number | undefined;
}

export interface ObservedSignatureStatus {
  readonly err: unknown;
  readonly confirmationStatus?: string | undefined;
}

export function classifySignature(observation: {
  readonly status: ObservedSignatureStatus | null | undefined;
  readonly finalized: { readonly blockHeight?: number; readonly absoluteSlot: number } | undefined;
  readonly statusSlot: number;
  readonly lastValidBlockHeight: number | undefined;
}): SignatureOutcome {
  const { status, finalized, statusSlot, lastValidBlockHeight } = observation;
  if (status) {
    if (status.err !== null) return status.confirmationStatus === "finalized" ? "failed" : "pending";
    return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized" ? "landed" : "pending";
  }
  return status === null && lastValidBlockHeight !== undefined && finalized?.blockHeight !== undefined
    && statusSlot >= finalized.absoluteSlot && finalized.blockHeight > lastValidBlockHeight ? "failed" : "pending";
}

export async function checkPaymentLanding(
  connection: Pick<Connection, "getEpochInfo" | "getSignatureStatuses">,
  { signature, lastValidBlockHeight }: PaymentToCheck,
): Promise<SignatureOutcome> {
  try {
    const finalized = lastValidBlockHeight === undefined
      ? undefined
      : await connection.getEpochInfo("finalized").catch(() => undefined);
    const { context, value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    return classifySignature({ status: value[0], statusSlot: context.slot, finalized, lastValidBlockHeight });
  } catch {
    return "pending";
  }
}

export interface UsdcLedger {
  debit(intentId: string, notional: UsdCents, memo: string, beforeBroadcast: BeforeBroadcast): Promise<Result<DebitReceipt, LedgerError>>;
  signPayment(payment: PaymentRequest): Promise<Result<SignedPayment, LedgerError>>;
  checkSignature(payment: PaymentToCheck): Promise<SignatureOutcome>;
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
    checkSignature: () => Promise.resolve("pending"),
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

export type DestinationCheck = "ok" | "missing" | "invalid";

export async function inspectTokenDestination(
  connection: Pick<Connection, "getAccountInfo">,
  destination: PublicKey,
  expected: { readonly mint: PublicKey; readonly owner: PublicKey },
): Promise<DestinationCheck> {
  const info = await connection.getAccountInfo(destination, commitment);
  if (info === null) return "missing";
  if (!info.owner.equals(TOKEN_PROGRAM_ID)) return "invalid";
  try {
    const account = unpackAccount(destination, info, TOKEN_PROGRAM_ID);
    const usable = account.mint.equals(expected.mint) && account.owner.equals(expected.owner) && account.isInitialized && !account.isFrozen;
    return usable && account.delegate === null && account.closeAuthority === null ? "ok" : "invalid";
  } catch {
    return "invalid";
  }
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
    owner: PublicKey,
    notional: UsdCents,
    memo: string,
  ): Promise<Result<{ readonly blockhash: string; readonly lastValidBlockHeight: number; readonly signature: string; readonly bytes: Buffer }, LedgerError>> {
    const amount = BigInt(notional) * baseUnitsPerCent;
    if (amount > maxTokenAmount) return { ok: false, error: { code: "notional-overflow" } };
    try {
      if (!isExpectedGenesis(network.cluster, await connection.getGenesisHash())) {
        return { ok: false, error: { code: "unsafe-ledger-network" } };
      }
      const destinationCheck = await inspectTokenDestination(connection, to, { mint, owner });
      if (destinationCheck === "missing") return { ok: false, error: { code: "recipient-ata-missing" } };
      if (destinationCheck === "invalid") return { ok: false, error: { code: "destination-invalid" } };
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
      const prepared = await prepareTransfer(payeeAta, payee, notional, memo);
      if (!prepared.ok) return prepared;
      return {
        ok: true,
        value: {
          signature: prepared.value.signature,
          blockhash: prepared.value.blockhash,
          lastValidBlockHeight: prepared.value.lastValidBlockHeight,
          transaction: prepared.value.bytes.toString("base64"),
          payer: authority.publicKey.toBase58(),
          explorerUrl: explorerUrl(prepared.value.signature, network),
        },
      };
    },
    checkSignature: (payment) => checkPaymentLanding(connection, payment),
    async debit(intentId, notional, memo, beforeBroadcast) {
      if (!Number.isSafeInteger(notional) || notional <= 0) {
        return { ok: false, error: { code: "invalid-notional" } };
      }
      if (!memo.startsWith(`${intentId}|`) || !memo.endsWith(`|${String(notional)}`)) {
        return { ok: false, error: { code: "debit-preparation-failed" } };
      }
      const prepared = await prepareTransfer(destination, recipient, notional, memo);
      if (!prepared.ok) return prepared;
      const { bytes, ...confirmation } = prepared.value;
      const recorded = await beforeBroadcast({
        signature: confirmation.signature,
        blockhash: confirmation.blockhash,
        lastValidBlockHeight: confirmation.lastValidBlockHeight,
        explorerUrl: explorerUrl(confirmation.signature, network),
      }).catch(() => false);
      if (!recorded) return { ok: false, error: { code: "pre-broadcast-failed" } };
      try {
        await connection.sendRawTransaction(bytes, { preflightCommitment: commitment });
        const { value } = await connection.confirmTransaction(confirmation, commitment);
        if (value.err !== null) return { ok: false, error: { code: "debit-unconfirmed", signature: confirmation.signature } };
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
