import type { Outcome } from "@/shared";

export const MAX_BET_CENTS = 1_000_000;

export type XCommand =
  | { readonly kind: "bet"; readonly outcome: Outcome; readonly notionalCents: number }
  | { readonly kind: "approve" }
  | { readonly kind: "status" }
  | { readonly kind: "unknown"; readonly text: string };

const LEADING_MENTIONS = /^(?:@\w+\s*)+/u;
const BET = /^(yes|no)\s*\$?\s*(\d+(?:\.\d{1,2})?)(?:\s*(?:usdc|usd|dollars?|bucks))?[.!]?$/u;
const APPROVE = /^(?:approve(?: it)?|do it|confirm)[.!]?$/u;
const STATUS = /^status[.!]?$/u;

function toCents(amount: string): number {
  const [whole = "0", fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function parseCommand(text: string): XCommand {
  const normalized = text.replace(LEADING_MENTIONS, "").trim().toLowerCase().replace(/\s+/gu, " ");
  const bet = BET.exec(normalized);
  if (bet) {
    const notionalCents = toCents(bet[2] ?? "");
    if (notionalCents > 0 && notionalCents <= MAX_BET_CENTS) {
      return { kind: "bet", outcome: bet[1] === "yes" ? "yes" : "no", notionalCents };
    }
    return { kind: "unknown", text: text.trim() };
  }
  if (APPROVE.test(normalized)) return { kind: "approve" };
  if (STATUS.test(normalized)) return { kind: "status" };
  return { kind: "unknown", text: text.trim() };
}
