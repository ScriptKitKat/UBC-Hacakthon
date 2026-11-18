import type { InstrumentSymbol } from "@/shared";

export interface ContractPrices {
  readonly bestBidCents: number | null;
  readonly bestAskCents: number | null;
  readonly lastTradeCents: number | null;
  readonly buyYesCents: number | null;
  readonly buyNoCents: number | null;
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
  readonly marketState: string;
  readonly status: string;
  readonly prices: ContractPrices;
  readonly limits: ContractLimits | null;
}

export interface MarketEvent {
  readonly ticker: string;
  readonly title: string;
  readonly category: string;
  readonly status: string;
  readonly expiryDate: string | null;
  readonly tags: readonly string[];
  readonly contracts: readonly MarketContract[];
}

export interface EventsPage {
  readonly events: readonly MarketEvent[];
  readonly total: number;
}
