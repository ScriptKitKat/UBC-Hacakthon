import { formatCents } from "@/features/markets";
import type { DecisionLogEntry, MatchView, PolicyView } from "@/shared";
import { fitTweet } from "./tweet";

export const NO_MATCH_NOTE = "No allowlisted Gemini market matched this news, so there is nothing to bet on here.";
export const NO_MARKET_REPLY = "No Gemini market is attached to this thread, so I can't place a bet here.";
export const NOT_ALLOWLISTED_REPLY = "Only allowlisted senders can request or approve trades or check status.";
export const NOTHING_PENDING_REPLY = "Nothing is waiting for approval in this thread.";
export const FAILURE_REPLY = "I couldn't complete that request. Nothing was executed; check the desk log.";

const BET_INSTRUCTION = "Reply 'yes 2' or 'no 2' to bet $2 USDC (paper Gemini ticket, Solana test USDC)";

export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatOdds(cents: number | null): string {
  return cents === null ? "—" : formatCents(cents);
}

function shortSignature(signature: string): string {
  return signature.length <= 14 ? signature : `${signature.slice(0, 8)}…${signature.slice(-4)}`;
}

export function composeNewsReply(match: Extract<MatchView, { kind: "matched" }>, policy: PolicyView): string {
  const { market } = match;
  const head = `${market.eventTitle} — ${market.contractLabel}`;
  const tail = [
    "",
    `Yes ${formatOdds(market.yesCents)} · No ${formatOdds(market.noCents)}`,
    `Daily budget left: ${formatDollars(policy.remainingCents)}`,
    BET_INSTRUCTION,
  ].join("\n");
  return fitTweet(head, tail);
}

export function composeDecisionReply(entry: DecisionLogEntry): string {
  switch (entry.kind) {
    case "approve": {
      const proof = [
        entry.ticket ? `Paper ticket ${entry.ticket.ticketId.slice(0, 8)}` : undefined,
        entry.signature ? `tx ${shortSignature(entry.signature)}` : undefined,
        entry.explorerUrl,
      ].filter((part) => part !== undefined);
      return fitTweet(entry.spokenReason, proof.length > 0 ? `\n${proof.join(" · ")}` : "");
    }
    case "needs-approval":
      return fitTweet(entry.spokenReason, "\nThe sender can reply \"approve\" to confirm.");
    case "refuse":
    case "execution-failed":
      return fitTweet(entry.spokenReason, "");
    default: {
      const exhaustive: never = entry.kind;
      return exhaustive;
    }
  }
}

export function composeStatusReply(policy: PolicyView, pendingCount: number): string {
  return fitTweet(
    `Budget left ${formatDollars(policy.remainingCents)}; spent ${formatDollars(policy.spentCents)} of ${formatDollars(policy.dailyCapCents)} today; ${String(pendingCount)} pending approval.`,
    "",
  );
}
