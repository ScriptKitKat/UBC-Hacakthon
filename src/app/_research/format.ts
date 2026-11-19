const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatCountdown(expiryIso: string | null, nowMs: number): string {
  if (expiryIso === null) return "No expiry listed";
  const expiryMs = Date.parse(expiryIso);
  if (Number.isNaN(expiryMs)) return "No expiry listed";
  const remaining = expiryMs - nowMs;
  if (remaining <= 0) return "Ended";
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);
  if (days > 0) return `${String(days)}d ${String(hours)}h left`;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m left`;
  return `${String(Math.max(1, minutes))}m left`;
}

export function formatVolume(volume: number | null): string {
  if (volume === null) return "n/a";
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 10_000) return `${String(Math.round(volume / 1000))}k`;
  if (volume >= 1000) return `${(volume / 1000).toFixed(1)}k`;
  return String(Math.round(volume * 100) / 100);
}

export function formatPriceCents(cents: number | null): string {
  if (cents === null) return "n/a";
  return `${String(Math.round(cents * 10) / 10)}¢`;
}

export function formatSignedCents(cents: number | null): string {
  if (cents === null) return "n/a";
  const rounded = Math.round(Math.abs(cents) * 10) / 10;
  return `${cents < 0 ? "−" : "+"}${String(rounded)}¢`;
}

export function formatDollarsFromCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function formatPercent(value: number | null, places = 1): string {
  if (value === null) return "n/a";
  const sign = value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(places)}%`;
}

export function formatAxisTime(ms: number, spanMs: number): string {
  const date = new Date(ms);
  if (spanMs <= DAY_MS * 1.5) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatFullTime(ms: number): string {
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
