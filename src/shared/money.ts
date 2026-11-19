const DOLLAR_AMOUNT = /^\d+(\.\d{1,2})?$/u;

export function parseDollarsToCents(text: string): number | undefined {
  const trimmed = text.trim();
  const cents = DOLLAR_AMOUNT.test(trimmed) ? Math.round(Number(trimmed) * 100) : NaN;
  return Number.isSafeInteger(cents) ? cents : undefined;
}
