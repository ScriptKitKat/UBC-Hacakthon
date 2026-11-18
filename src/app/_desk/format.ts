export function formatCents(cents: number): string {
  return `${String(cents)}¢`;
}

export function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const DOLLAR_AMOUNT = /^\d+(\.\d{1,2})?$/u;

export function parseDollarsToCents(text: string): number | undefined {
  const trimmed = text.trim();
  return DOLLAR_AMOUNT.test(trimmed) ? Math.round(Number(trimmed) * 100) : undefined;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
