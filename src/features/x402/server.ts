import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Connection, PublicKey } from "@solana/web3.js";
import { isExpectedGenesis } from "@/features/ledger";
import { inspectPayment } from "./inspect";
import type { InspectedPayment } from "./inspect";
import { paymentMemo, parsePaymentMemo } from "./nonce";
import type { NonceCodec } from "./nonce";
import { X402_VERSION, decodeHeader, paymentPayloadSchema } from "./schema";
import type { PaymentErrorCode, PaymentRequired, X402Network } from "./schema";
import type { UsedPayments } from "./store";

const CONFIRM_COMMITMENT = "confirmed";
const BLOCKHASH_VALIDITY_BLOCKS = 150;
const PARSED_TRANSACTION_ATTEMPTS = 5;
const PARSED_TRANSACTION_RETRY_MS = 300;

export type SettlementConnection = Pick<
  Connection,
  "getBlockHeight" | "getGenesisHash" | "getParsedTransaction" | "confirmTransaction" | "sendRawTransaction" | "simulateTransaction"
>;

export interface X402ServerConfig {
  readonly network: X402Network;
  readonly mint: PublicKey;
  readonly payTo: PublicKey;
  readonly priceBaseUnits: bigint;
  readonly maxTimeoutSeconds: number;
  readonly mimeType: string;
}

export interface X402ServerDeps {
  readonly config: X402ServerConfig;
  readonly connection: SettlementConnection;
  readonly used: UsedPayments;
  readonly nonces: NonceCodec;
  readonly nowMs: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

type Result<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: PaymentErrorCode };

export interface VerifiedPayment {
  readonly symbol: string;
  readonly nonce: string;
  readonly payment: InspectedPayment;
}

export interface Settlement {
  readonly signature: string;
  readonly payer: string;
  readonly network: X402Network;
}

export interface X402Server {
  readonly requirements: (symbol: string, resource: string, description: string, error: string) => PaymentRequired;
  readonly verify: (paymentHeader: string, symbol: string) => Promise<Result<VerifiedPayment>>;
  readonly settle: (verified: VerifiedPayment) => Promise<Result<Settlement>>;
}

const fail = (error: PaymentErrorCode): { readonly ok: false; readonly error: PaymentErrorCode } => ({ ok: false, error });

export function createX402Server(deps: X402ServerDeps): X402Server {
  const { config, connection, used, nonces, nowMs, sleep } = deps;
  const destination = getAssociatedTokenAddressSync(config.mint, config.payTo);
  const expected = { mint: config.mint, destination, amount: config.priceBaseUnits };
  let networkVerified = false;

  async function onExpectedNetwork(): Promise<boolean> {
    if (networkVerified) return true;
    try {
      const cluster = config.network === "solana-devnet" ? "devnet" : "localnet";
      networkVerified = isExpectedGenesis(cluster, await connection.getGenesisHash());
    } catch {
      return false;
    }
    return networkVerified;
  }

  async function paidAmountMatches(signature: string): Promise<boolean> {
    for (let attempt = 0; attempt < PARSED_TRANSACTION_ATTEMPTS; attempt += 1) {
      const parsed = await connection.getParsedTransaction(signature, { commitment: CONFIRM_COMMITMENT, maxSupportedTransactionVersion: 0 });
      const meta = parsed?.meta;
      if (meta) {
        if (meta.err !== null) return false;
        const balanceOf = (balances: typeof meta.preTokenBalances) => balances
          ?.filter((balance) => balance.mint === config.mint.toBase58() && balance.owner === config.payTo.toBase58())
          .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), 0n) ?? 0n;
        return balanceOf(meta.postTokenBalances) - balanceOf(meta.preTokenBalances) === config.priceBaseUnits;
      }
      await sleep(PARSED_TRANSACTION_RETRY_MS);
    }
    return false;
  }

  return {
    requirements(symbol, resource, description, error) {
      const nonce = nonces.issue(symbol, nowMs());
      return {
        x402Version: X402_VERSION,
        error,
        accepts: [
          {
            scheme: "exact",
            network: config.network,
            maxAmountRequired: config.priceBaseUnits.toString(),
            asset: config.mint.toBase58(),
            payTo: config.payTo.toBase58(),
            resource,
            description,
            mimeType: config.mimeType,
            maxTimeoutSeconds: config.maxTimeoutSeconds,
            extra: { nonce, memo: paymentMemo(symbol, nonce) },
          },
        ],
      };
    },

    async verify(paymentHeader, symbol) {
      const payload = decodeHeader(paymentPayloadSchema, paymentHeader);
      if (!payload) return fail("invalid_header");
      if (payload.network !== config.network) return fail("wrong_network");
      const inspected = inspectPayment(payload.payload.transaction, expected);
      if (!inspected.ok) return inspected;
      const memo = parsePaymentMemo(inspected.value.memo);
      if (!memo || memo.symbol !== symbol) return fail("memo_mismatch");
      const nonceCheck = nonces.check(memo.nonce, symbol, nowMs());
      if (nonceCheck !== "ok") return fail(nonceCheck);
      const reused = used.reuse(memo.nonce, inspected.value.signature);
      if (reused) return fail(reused);
      if (!await onExpectedNetwork()) return fail("wrong_network");
      try {
        const simulation = await connection.simulateTransaction(VersionedTransaction.deserialize(inspected.value.rawTransaction), { sigVerify: true, commitment: CONFIRM_COMMITMENT });
        if (simulation.value.err !== null) return fail("simulation_failed");
      } catch {
        return fail("simulation_failed");
      }
      return { ok: true, value: { symbol, nonce: memo.nonce, payment: inspected.value } };
    },

    async settle({ nonce, payment }) {
      const claimError = await used.claim(nonce, payment.signature, nowMs());
      if (claimError) return fail(claimError);
      try {
        const signature = await connection.sendRawTransaction(payment.rawTransaction, { preflightCommitment: CONFIRM_COMMITMENT });
        if (signature !== payment.signature) return fail("settlement_failed");
        const blockhash = Transaction.from(payment.rawTransaction).recentBlockhash;
        if (!blockhash) return fail("settlement_failed");
        const lastValidBlockHeight = (await connection.getBlockHeight(CONFIRM_COMMITMENT)) + BLOCKHASH_VALIDITY_BLOCKS;
        const { value } = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, CONFIRM_COMMITMENT);
        if (value.err) return fail("settlement_failed");
        if (!await paidAmountMatches(signature)) return fail("settlement_mismatch");
        return { ok: true, value: { signature, payer: payment.payer, network: config.network } };
      } catch {
        return fail("settlement_failed");
      }
    },
  };
}
