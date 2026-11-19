import { createHmac, timingSafeEqual } from "node:crypto";

const MAC_LENGTH = 32;
const MEMO_PREFIX = "x402";

export type NonceCheck = "ok" | "nonce_invalid" | "expired";

export interface PaymentTerms {
  readonly symbol: string;
  readonly resource: string;
  readonly amount: string;
  readonly asset: string;
  readonly payTo: string;
  readonly network: string;
}

export interface NonceCodec {
  readonly issue: (terms: PaymentTerms, nowMs: number) => string;
  readonly check: (nonce: string, terms: PaymentTerms, nowMs: number) => NonceCheck;
}

export interface NonceCodecOptions {
  readonly secret: string;
  readonly ttlMs: number;
  readonly randomHex: () => string;
}

function mac(secret: string, terms: PaymentTerms, expiresAtMs: string, random: string): string {
  const { symbol, resource, amount, asset, payTo, network } = terms;
  return createHmac("sha256", secret).update(JSON.stringify([symbol, resource, amount, asset, payTo, network, expiresAtMs, random])).digest("hex").slice(0, MAC_LENGTH);
}

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createNonceCodec(options: NonceCodecOptions): NonceCodec {
  const { secret, ttlMs, randomHex } = options;
  return {
    issue(terms, nowMs) {
      const expiresAtMs = String(nowMs + ttlMs);
      const random = randomHex();
      return `${expiresAtMs}.${random}.${mac(secret, terms, expiresAtMs, random)}`;
    },
    check(nonce, terms, nowMs) {
      const [expiresAtMs, random, tag, ...rest] = nonce.split(".");
      if (expiresAtMs === undefined || random === undefined || tag === undefined || rest.length > 0 || !/^\d+$/.test(expiresAtMs)) {
        return "nonce_invalid";
      }
      if (!sameText(tag, mac(secret, terms, expiresAtMs, random))) return "nonce_invalid";
      return Number(expiresAtMs) <= nowMs ? "expired" : "ok";
    },
  };
}

export function paymentMemo(symbol: string, nonce: string): string {
  return `${MEMO_PREFIX}|${symbol}|${nonce}`;
}

export function parsePaymentMemo(memo: string): { readonly symbol: string; readonly nonce: string } | undefined {
  const [prefix, symbol, nonce, ...rest] = memo.split("|");
  if (prefix !== MEMO_PREFIX || !symbol || !nonce || rest.length > 0) return undefined;
  return { symbol, nonce };
}
