import type { Outcome, TradeSource } from "./types";

type RetiredTradeSource = "voice";

export type DecisionSource = TradeSource | RetiredTradeSource | "research";

export type DecisionKind = "approve" | "needs-approval" | "refuse" | "execution-failed";

export interface TicketView {
  readonly ticketId: string;
  readonly symbol: string;
  readonly outcome: Outcome;
  readonly quantity: string;
  readonly price: string;
  readonly mode: "paper";
}

export interface DecisionLogEntry {
  readonly entryId: string;
  readonly kind: DecisionKind;
  readonly code?: string;
  readonly spokenReason: string;
  readonly intentId: string;
  readonly symbol: string;
  readonly outcome: Outcome | null;
  readonly notionalCents: number;
  readonly seenPriceCents?: number;
  readonly senderId: string;
  readonly source: DecisionSource;
  readonly signature?: string;
  readonly explorerUrl?: string;
  readonly ticket?: TicketView;
  readonly at: string;
}

export interface NewsView {
  readonly id: string;
  readonly text: string;
  readonly url?: string;
  readonly sourceDomain?: string;
  readonly author?: string;
  readonly postedAt: string;
}

export interface MarketView {
  readonly eventTicker: string;
  readonly eventTitle: string;
  readonly contractLabel: string;
  readonly instrumentSymbol: string;
  readonly yesCents: number | null;
  readonly noCents: number | null;
  readonly marketState: string;
}

export type MatchView =
  | { readonly kind: "no-news" }
  | { readonly kind: "no-match"; readonly reason: string }
  | { readonly kind: "matched"; readonly market: MarketView; readonly reasons: readonly string[] };

export interface PolicyView {
  readonly dailyCapCents: number;
  readonly spentCents: number;
  readonly researchSpentCents: number;
  readonly remainingCents: number;
  readonly autoApproveMaxCents: number;
  readonly perTradeMaxCents: number;
  readonly killSwitch: boolean;
  readonly marketAllowlist: readonly string[];
  readonly marketCategories: readonly string[];
  readonly senderAllowlist: readonly string[];
}

export interface PendingView {
  readonly intentId: string;
  readonly symbol: string;
  readonly outcome: Outcome;
  readonly notionalCents: number;
  readonly senderId: string;
  readonly createdAt: string;
}

export type LedgerView =
  | {
      readonly configured: true;
      readonly cluster: "localnet" | "devnet";
      readonly authority: string;
      readonly mint: string;
      readonly recipient: string;
    }
  | { readonly configured: false; readonly missing: readonly string[] };

export interface DeskSnapshot {
  readonly news: NewsView | null;
  readonly match: MatchView;
  readonly policy: PolicyView;
  readonly pending: readonly PendingView[];
  readonly log: readonly DecisionLogEntry[];
  readonly ledger: LedgerView;
}
