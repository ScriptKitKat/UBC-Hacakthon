import type { InstrumentSymbol } from "@/shared";

export interface ContractPrices {
  readonly bestBidCents: number | null;
  readonly bestAskCents: number | null;
  readonly lastTradeCents: number | null;
  readonly buyYesCents: number | null;
  readonly buyNoCents: number | null;
  readonly sellYesCents: number | null;
  readonly sellNoCents: number | null;
}

export interface ContractLimits {
  readonly quantityIncrementHundredths: bigint;
  readonly quantityMinimumHundredths: bigint;
  readonly priceIncrementCents: bigint;
  readonly priceMinimumCents: bigint;
}

export interface MarketContract {
  readonly instrumentSymbol: InstrumentSymbol;
  readonly label: string;
  readonly description: string;
  readonly expiryDate: string | null;
  readonly resolutionSide?: "yes" | "no";
  readonly marketState: string;
  readonly status: string;
  readonly prices: ContractPrices;
  readonly limits: ContractLimits | null;
  readonly abbreviatedName?: string | null;
  readonly color?: string | null;
  readonly strikeValue?: number | null;
  readonly createdAt?: string | null;
}

export interface MarketEvent {
  readonly ticker: string;
  readonly slug?: string;
  readonly title: string;
  readonly category: string;
  readonly status: string;
  readonly expiryDate: string | null;
  readonly description: string;
  readonly subcategory: string | null;
  readonly volume: number | null;
  readonly volume24h: number | null;
  readonly tags: readonly string[];
  readonly contracts: readonly MarketContract[];
  readonly isLive?: boolean;
  readonly createdAt?: string | null;
  readonly startTime?: string | null;
}

export interface EventsPage {
  readonly events: readonly MarketEvent[];
  readonly total: number;
}

export type CandleTimeframe = "1m" | "5m" | "15m" | "30m" | "1hr" | "6hr" | "1day";

export interface Candle {
  readonly timeMs: number;
  readonly openCents: number;
  readonly highCents: number;
  readonly lowCents: number;
  readonly closeCents: number;
  readonly volume: number;
}

export interface BookLevel {
  readonly priceCents: number;
  readonly amount: number;
}

export interface OrderBook {
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
}

export interface RecentTrade {
  readonly tradeId: number;
  readonly timeMs: number;
  readonly priceCents: number;
  readonly amount: number;
  readonly side: "buy" | "sell";
}

export interface SpotTicker {
  readonly last: number;
}
