export function formatPercent(percent: number | null): string {
  return percent === null ? "—" : `${String(Math.round(percent))}%`;
}

export function formatSignedPercent(percent: number): string {
  if (percent === 0) return "0%";
  return `${percent > 0 ? "+" : "−"}${String(Math.abs(percent))}%`;
}

export function formatChangePercent(from: number, to: number): string | null {
  if (from <= 0) return null;
  const change = Math.round(((to - from) / from) * 1000) / 10;
  return formatSignedPercent(change);
}

export function changeTrend(percent: number | null): "up" | "down" | "flat" {
  if (percent === null || percent === 0) return "flat";
  return percent > 0 ? "up" : "down";
}

export function formatBudgetCents(cents: number): string {
  const dollars = cents / 100;
  const text = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${text}`;
}

export function isXUrl(value: string): boolean {
  const parsed = URL.parse(value.trim());
  if (parsed === null || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) return false;
  const host = parsed.hostname.replace(/^www\./u, "").toLowerCase();
  return host === "x.com" || host === "twitter.com";
}
