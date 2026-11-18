import type { MarketView } from "./desk";

export type FeedMatchedBy = "grok" | "keywords";

export interface PricePoint {
  readonly at: string;
  readonly yesCents: number;
}

export interface FeedMarketView extends MarketView {
  readonly category: string;
  readonly impliedYesPercent: number | null;
  readonly bestBidCents: number | null;
  readonly bestAskCents: number | null;
  readonly lastTradeCents: number | null;
  readonly tradeable: boolean;
  readonly tradeBlockedReason?: string;
}

export type FeedMatch =
  | {
      readonly kind: "matched";
      readonly postId: string;
      readonly matchedBy: FeedMatchedBy;
      readonly confidence: number;
      readonly why: string;
      readonly market: FeedMarketView;
    }
  | {
      readonly kind: "no-match";
      readonly postId: string;
      readonly matchedBy: FeedMatchedBy;
      readonly reason: string;
    };

export interface FeedQuote {
  readonly market: FeedMarketView;
  readonly history: readonly PricePoint[];
}
