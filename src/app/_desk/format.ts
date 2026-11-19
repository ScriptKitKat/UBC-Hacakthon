export function formatCents(cents: number): string {
  return `${String(cents)}¢`;
}

export function formatChance(cents: number): string {
  return `${String(Math.round(percentOf(cents, 100)))}% chance`;
}

export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export { parseDollarsToCents } from "@/shared";

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function percentOf(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.min(100, Math.max(0, (part / whole) * 100));
}

export function yesSharePercent(yesCents: number | null, noCents: number | null): number | undefined {
  if (yesCents === null && noCents === null) return undefined;
  const yes = yesCents ?? 100 - (noCents ?? 0);
  const no = noCents ?? 100 - yes;
  return percentOf(yes, yes + no);
}

export type BudgetTone = "healthy" | "low" | "critical";

const CRITICAL_REMAINING_PERCENT = 10;
const LOW_REMAINING_PERCENT = 25;

export function budgetTone(remainingCents: number, capCents: number): BudgetTone {
  const remainingPercent = percentOf(remainingCents, capCents);
  if (remainingPercent <= CRITICAL_REMAINING_PERCENT) return "critical";
  return remainingPercent <= LOW_REMAINING_PERCENT ? "low" : "healthy";
}

export function shortenMiddle(text: string, head: number, tail: number): string {
  return text.length > head + tail + 1 ? `${text.slice(0, head)}…${text.slice(-tail)}` : text;
}
