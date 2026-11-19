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

export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
}

export function formatResetLabel(resetAt: string, timeZone?: string): string {
  const date = new Date(resetAt);
  if (!Number.isFinite(date.getTime())) return "resets 12:00 am";
  const text = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  return `resets ${text}`;
}

export function formatVolumeUsd(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    const millions = amount / 1_000_000;
    const text = millions >= 10 ? millions.toFixed(0) : millions.toFixed(1);
    return `$${text.replace(/\.0$/u, "")}M`;
  }
  if (abs >= 1_000) {
    const thousands = amount / 1_000;
    const text = thousands >= 10 ? thousands.toFixed(1) : thousands.toFixed(1);
    return `$${text.replace(/\.0$/u, "")}k`;
  }
  if (Number.isInteger(amount)) return `$${String(amount)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatPayoutFromAsk(askCents: number | null, beginner: boolean): string | null {
  if (askCents === null || !(askCents > 0) || askCents > 100) return null;
  const multiple = 100 / askCents;
  return beginner ? `$1 → $${multiple.toFixed(2)}` : `${multiple.toFixed(1)}x`;
}

export function contrastInk(background: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(background.trim());
  if (hex === null) return "#EDEDED";
  const raw = hex[1] ?? "";
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw;
  const int = Number.parseInt(full, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "#0A0A0A" : "#EDEDED";
}
