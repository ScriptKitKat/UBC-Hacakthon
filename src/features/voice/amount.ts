import { usdCents } from "@/shared";
import type { UsdCents } from "@/shared";

const CENTS_PER_DOLLAR = 100;
const FLOAT_TOLERANCE = 1e-6;

export function usdToCents(dollars: number): UsdCents | undefined {
  if (!Number.isFinite(dollars) || dollars <= 0) return undefined;
  const scaled = dollars * CENTS_PER_DOLLAR;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > FLOAT_TOLERANCE) return undefined;
  return usdCents(cents);
}

export function centsToUsd(cents: number): number {
  return cents / CENTS_PER_DOLLAR;
}
