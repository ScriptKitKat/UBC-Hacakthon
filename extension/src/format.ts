export function formatCents(cents: number | null): string {
  return cents === null ? "—" : `${String(Math.round(cents))}¢`;
}

export function formatPercent(percent: number | null): string {
  return percent === null ? "—" : `${String(Math.round(percent))}%`;
}

export function formatDollars(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `$${String(whole)}` : `$${String(whole)}.${String(rest).padStart(2, "0")}`;
}

export function clampPercent(value: number | null): number {
  return value === null ? 50 : Math.min(100, Math.max(0, value));
}
