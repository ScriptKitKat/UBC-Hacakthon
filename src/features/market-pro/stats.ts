import type { Candle, ContractPrices } from "@/features/markets";
import { formatVolumeUsd } from "@/shared";
import type { ProStat, ProStats } from "@/shared";
import { GEMINI_UNAVAILABLE_REASON } from "@/shared";
import { DAY_MS_VALUE } from "./timeframes";

const MAX_PAYOUT = "$1.00";

export function shown(text: string, tone: "up" | "down" | "neutral" = "neutral"): ProStat {
  return { kind: "value", text, tone };
}

export function hidden(reason = GEMINI_UNAVAILABLE_REASON): ProStat {
  return { kind: "unavailable", reason };
}

export function formatPrice(cents: number): string {
  const rounded = Math.round(cents * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}¢`;
}

export function formatSignedPoints(cents: number): string {
  const rounded = Math.round(Math.abs(cents) * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  if (cents > 0) return `+${text}`;
  if (cents < 0) return `−${text}`;
  return "0";
}

export function formatResolvesIn(expiryDate: string | null, nowMs: number): ProStat {
  if (expiryDate === null) return hidden("This market has no expiry time from Gemini.");
  const expiryMs = Date.parse(expiryDate);
  if (!Number.isFinite(expiryMs)) return hidden("This market has no expiry time from Gemini.");
  const remaining = expiryMs - nowMs;
  if (remaining <= 0) return shown("Ended");
  const days = Math.floor(remaining / DAY_MS_VALUE);
  const hours = Math.floor((remaining % DAY_MS_VALUE) / (60 * 60 * 1000));
  if (days > 0) return shown(`${String(days)}d ${String(hours)}h`);
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / 60_000);
  if (hours > 0) return shown(`${String(hours)}h ${String(minutes)}m`);
  return shown(`${String(Math.max(1, minutes))}m`);
}

export function trailingWindow(candles: readonly Candle[], nowMs: number, windowMs: number): Candle[] {
  const start = nowMs - windowMs;
  return candles.filter((candle) => candle.timeMs >= start && candle.timeMs <= nowMs);
}

export function windowHighLow(candles: readonly Candle[]): { readonly high: number; readonly low: number } | null {
  if (candles.length === 0) return null;
  return {
    high: Math.max(...candles.map((candle) => candle.highCents)),
    low: Math.min(...candles.map((candle) => candle.lowCents)),
  };
}

export function windowChange(candles: readonly Candle[]): number | null {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (first === undefined || last === undefined) return null;
  return last.closeCents - first.openCents;
}

export function lastPrice(prices: ContractPrices, lastTradeFallback: number | null): number | null {
  return prices.lastTradeCents ?? lastTradeFallback ?? prices.bestAskCents ?? prices.buyYesCents ?? prices.bestBidCents;
}

export function buildStats(input: {
  readonly prices: ContractPrices;
  readonly hourly: readonly Candle[];
  readonly volume: number | null;
  readonly volume24h: number | null;
  readonly expiryDate: string | null;
  readonly nowMs: number;
}): ProStats {
  const last = lastPrice(input.prices, input.hourly[input.hourly.length - 1]?.closeCents ?? null);
  const day = trailingWindow(input.hourly, input.nowMs, DAY_MS_VALUE);
  const change = windowChange(day);
  const range = windowHighLow(day);
  const bid = input.prices.bestBidCents ?? input.prices.sellYesCents;
  const ask = input.prices.bestAskCents ?? input.prices.buyYesCents;
  const volume24h = input.volume24h ?? (day.length > 0 ? day.reduce((sum, candle) => sum + candle.volume, 0) : null);
  return {
    last: last === null ? hidden("Gemini has not published a last price for this contract.") : shown(formatPrice(last)),
    change24h: change === null
      ? hidden("Need 24 hours of candles to show the daily change.")
      : shown(formatSignedPoints(change), change > 0 ? "up" : change < 0 ? "down" : "neutral"),
    bidAsk: bid === null || ask === null
      ? hidden("Gemini has not published a bid and ask for this contract.")
      : shown(`${formatPrice(bid).replace("¢", "")} / ${formatPrice(ask).replace("¢", "")}`),
    highLow24h: range === null
      ? hidden("Need 24 hours of candles to show the daily high and low.")
      : shown(`${formatPrice(range.high).replace("¢", "")} / ${formatPrice(range.low).replace("¢", "")}`),
    volume24h: volume24h === null ? hidden("Gemini has not published 24-hour volume for this event.") : shown(formatVolumeUsd(volume24h)),
    volumeTotal: input.volume === null ? hidden("Gemini has not published total volume for this event.") : shown(formatVolumeUsd(input.volume)),
    openInterest: hidden("Gemini does not publish open interest for prediction markets."),
    traders: hidden("Gemini does not publish a trader count for prediction markets."),
    resolvesIn: formatResolvesIn(input.expiryDate, input.nowMs),
    maxPayout: shown(MAX_PAYOUT),
  };
}
