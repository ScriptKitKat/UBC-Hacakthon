const AMOUNT = /(\$)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?(?:k|m|b|bn|million|billion))?(?![\w%])/giu;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/gu;
const NUMBER = /\d[\d,]*(?:\.\d+)?/gu;
const THOUSAND = 1000;

export function normalizePhrase(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

export function phrasePosition(normalizedText: string, phrase: string): number {
  return ` ${normalizedText} `.indexOf(` ${phrase} `);
}

export function mentionedAmounts(text: string): readonly number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(AMOUNT)) {
    const [, dollar, digits = "", suffix = ""] = match;
    const unit = suffix.trim().toLowerCase();
    const value = Number(digits.replaceAll(",", ""));
    if (unit !== "" && unit !== "k") continue;
    if (dollar !== undefined || unit === "k" || digits.includes(",")) amounts.push(unit === "k" ? value * THOUSAND : value);
  }
  return amounts;
}

export function mentionedPercents(text: string): readonly number[] {
  return [...text.matchAll(PERCENT)].map((match) => Number(match[1]));
}

export function labelDistance(label: string, value: number): number {
  const numbers = (label.match(NUMBER) ?? []).map((token) => Number(token.replaceAll(",", "")));
  if (numbers.length === 0) return Number.POSITIVE_INFINITY;
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  if (numbers.length === 1) return Math.abs(value - low);
  return value < low ? low - value : value > high ? value - high : 0;
}
