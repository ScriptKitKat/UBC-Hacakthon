import type { DecisionKind, MarketView } from "./desk";

export type XMessageRole = "news" | "bot" | "user";

export interface XMessageView {
  readonly id: string;
  readonly role: XMessageRole;
  readonly text: string;
  readonly author: string;
  readonly at: string;
  readonly postedToX: boolean;
  readonly postError?: string;
  readonly decisionKind?: DecisionKind;
  readonly ticketId?: string;
  readonly signature?: string;
  readonly explorerUrl?: string;
}

export interface XOutcomeView {
  readonly intentId: string;
  readonly kind: DecisionKind;
  readonly at: string;
}

export interface XThreadView {
  readonly id: string;
  readonly market: MarketView | null;
  readonly messages: readonly XMessageView[];
  readonly outcomes: readonly XOutcomeView[];
}

export interface XBotStatusView {
  readonly mode: "fake" | "live";
  readonly configuredMissing: readonly string[];
}
