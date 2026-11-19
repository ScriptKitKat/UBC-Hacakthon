export { formatBudgetCents, isXUrl } from "@/shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  economics: "Economy",
};

const CATEGORY_QUERY: Readonly<Record<string, string>> = {
  economy: "Economics",
  "tech and ai": "Tech",
};

export function categoryLabel(category: string): string {
  const key = category.trim().toLowerCase();
  return CATEGORY_LABELS[key] ?? (category.trim() === "" ? "Other" : category.trim());
}

export function categoryQuery(label: string): string | undefined {
  const key = label.trim().toLowerCase();
  if (key === "" || key === "all") return undefined;
  return CATEGORY_QUERY[key] ?? label.trim();
}

export function formatEndsIn(expiryDate: string | null, now: Date): string | null {
  if (expiryDate === null) return null;
  const remaining = Date.parse(expiryDate) - now.getTime();
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return "ended";
  if (remaining < DAY_MS) {
    const hours = Math.max(1, Math.round(remaining / HOUR_MS));
    return `ends in ${String(hours)}h`;
  }
  const days = Math.max(1, Math.round(remaining / DAY_MS));
  return `ends in ${String(days)}d`;
}

export function changePercent(first: number, last: number): number | null {
  if (first <= 0) return null;
  return Math.round(((last - first) / first) * 1000) / 10;
}

export function formatChange(percent: number): string {
  if (percent === 0) return "0%";
  const magnitude = String(Math.abs(percent));
  return `${percent > 0 ? "▲" : "▼"} ${magnitude}%`;
}

export function downsample(values: readonly number[], limit: number): number[] {
  if (values.length <= limit) return [...values];
  if (limit <= 1) return values.length === 0 ? [] : [values[values.length - 1] ?? 0];
  const out: number[] = [];
  const last = values.length - 1;
  for (let index = 0; index < limit; index += 1) {
    const source = Math.round((index / (limit - 1)) * last);
    out.push(values[source] ?? 0);
  }
  return out;
}

export const SPARKLINE_POINTS = 48;
export const WINDOW_MS = DAY_MS;


export function smoothSeries(values: readonly number[]): number[] {
  if (values.length < 4) return [...values];
  return values.map((value, index) => {
    if (index === 0 || index === values.length - 1) return value;
    const prev = values[index - 1] ?? value;
    const next = values[index + 1] ?? value;
    return (prev + value * 2 + next) / 4;
  });
}
