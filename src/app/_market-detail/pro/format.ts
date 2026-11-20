import { formatBudgetCents } from "@/shared";
import type { ProStat } from "@/shared";

const VIEW_TZ = "America/Chicago";

export function formatCents(cents: number): string {
  const rounded = Math.round(cents * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}¢`;
}

export function formatSignedCents(cents: number): string {
  const rounded = Math.round(Math.abs(cents) * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  if (cents > 0) return `+${text}`;
  if (cents < 0) return `−${text}`;
  return "0";
}

export function formatDollars(cents: number, signed = false): string {
  const dollars = cents / 100;
  const body = `${dollars < 0 ? "−" : signed && dollars > 0 ? "+" : ""}$${Math.abs(dollars).toFixed(2)}`;
  return body;
}

export function formatShares(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatClock(timeMs: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: VIEW_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timeMs));
}

export function formatFeedTime(timeMs: number | null, nowMs: number): string {
  if (timeMs === null) return "—";
  const sameDay = new Intl.DateTimeFormat("en-US", { timeZone: VIEW_TZ, year: "numeric", month: "numeric", day: "numeric" });
  if (sameDay.format(new Date(timeMs)) === sameDay.format(new Date(nowMs))) {
    return new Intl.DateTimeFormat("en-US", { timeZone: VIEW_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timeMs));
  }
  return new Intl.DateTimeFormat("en-US", { timeZone: VIEW_TZ, month: "short", day: "numeric" }).format(new Date(timeMs));
}

export function formatAxisTime(timeMs: number, timeframe: "5m" | "1h" | "4h" | "1D" | "1W"): string {
  const date = new Date(timeMs);
  if (timeframe === "5m" || timeframe === "1h") {
    return new Intl.DateTimeFormat("en-US", { timeZone: VIEW_TZ, hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { timeZone: VIEW_TZ, month: "short", day: "numeric" }).format(date);
}

export function formatSpot(last: number): string {
  if (last >= 1000) return `$${last.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (last >= 10) return `$${last.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${last.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).replace(/0+$/u, "").replace(/\.$/u, "")}`;
}

export function formatPercentMove(value: number): string {
  const pct = value * 100;
  const text = Math.abs(pct).toFixed(1);
  if (pct > 0) return `+${text}%`;
  if (pct < 0) return `−${text}%`;
  return "0%";
}

export function formatUsdCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    const thousands = amount / 1000;
    const text = Math.abs(thousands) >= 10 ? thousands.toFixed(1) : thousands.toFixed(1);
    return `$${text.replace(/\.0$/u, "")}k`;
  }
  return `$${amount.toFixed(amount >= 100 ? 0 : 2)}`;
}

export function statClass(stat: ProStat): "up" | "down" | "muted" | "plain" {
  if (stat.kind === "unavailable") return "muted";
  if (stat.tone === "up") return "up";
  if (stat.tone === "down") return "down";
  return "plain";
}

export function overLimitNote(perTradeMaxCents: number, remainingCents: number): string {
  return `Over your limit: max ${formatBudgetCents(perTradeMaxCents)} per trade (${formatBudgetCents(remainingCents)} left today)`;
}

export { formatBudgetCents, formatResetLabel } from "@/shared";
