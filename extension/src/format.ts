import { formatChangePercent as sharedChangePercent, formatPercent as sharedPercent } from "@/shared";

export function formatCents(cents: number | null): string {
  return cents === null ? "—" : `${String(Math.round(cents))}¢`;
}

export const formatPercent = sharedPercent;
export const formatChangePercent = sharedChangePercent;

function formatAmount(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(whole) : `${String(whole)}.${String(rest).padStart(2, "0")}`;
}

export function formatDollars(cents: number): string {
  return `$${formatAmount(cents)}`;
}

export function formatUsdc(cents: number): string {
  return `${formatAmount(cents)} USDC`;
}

export function clampPercent(value: number | null): number {
  return value === null ? 50 : Math.min(100, Math.max(0, value));
}

export function formatHistoryWindow(fromIso: string, toIso: string): string | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const seconds = Math.round((to - from) / 1000);
  if (seconds < 60) return `${String(Math.max(1, seconds))}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)}h`;
  return `${String(Math.round(hours / 24))}d`;
}
