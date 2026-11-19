import type { RecentTrade } from "@/features/markets";
import type { ProFlow } from "@/shared";

const LARGE_TRADE_DOLLARS = 1000;

function notional(trade: RecentTrade): number {
  return (trade.priceCents / 100) * trade.amount;
}

export function flowFromTrades(trades: readonly RecentTrade[]): ProFlow | null {
  if (trades.length === 0) return null;
  const buyNotional = trades.filter((trade) => trade.side === "buy").reduce((sum, trade) => sum + notional(trade), 0);
  const sellNotional = trades.filter((trade) => trade.side === "sell").reduce((sum, trade) => sum + notional(trade), 0);
  const total = buyNotional + sellNotional;
  const large = trades.filter((trade) => notional(trade) >= LARGE_TRADE_DOLLARS);
  const largeNet = large.reduce((sum, trade) => sum + (trade.side === "buy" ? notional(trade) : -notional(trade)), 0);
  return {
    buyPercent: total > 0 ? Math.round((buyNotional / total) * 100) : null,
    sellPercent: total > 0 ? Math.round((sellNotional / total) * 100) : null,
    largeTradeCount: large.length,
    largeTradeNetNotional: large.length === 0 ? 0 : largeNet,
    averageTradeNotional: total / trades.length,
    sampleSize: trades.length,
    windowLabel: "Recent prints from Gemini",
  };
}
