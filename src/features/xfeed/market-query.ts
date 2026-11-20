import { searchTokens } from "@/features/matcher";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const TIME_ZONES = ["est", "edt", "et", "cst", "cdt", "ct", "pst", "pdt", "pt", "utc", "gmt", "am", "pm"];
const MARKET_WORDING = ["above", "below", "many", "much", "price", "today", "tomorrow", "why", "vs", "versus", "highest", "lowest", "total", "points", "point", "spread", "winner"];
const QUERY_STOPWORDS = new Set([...MARKET_WORDING, ...MONTHS, ...TIME_ZONES]);
const MIN_PLAIN_TERM_LENGTH = 3;
const CLOCK_TIME = /^\p{N}+(?:am|pm)$/u;
const TITLE_TERMS = /[\p{L}]+(?:&[\p{L}]+)*|\p{N}+/gu;
const NUMBER = /^\p{N}+$/u;

function titleTerms(title: string): readonly string[] {
  return title.match(TITLE_TERMS) ?? [];
}

function isTicker(token: string): boolean {
  if (token.includes("&")) return true;
  return token.length >= 2 && token === token.toUpperCase() && token !== token.toLowerCase() && searchTokens(token).some(isQueryTerm);
}

function tickerTerms(tokens: readonly string[]): string[] {
  const terms: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !isTicker(token)) continue;
    const next = tokens[index + 1];
    if (next !== undefined && NUMBER.test(next)) {
      terms.push(token.includes("&") ? `"${token} ${next}"` : `${token} ${next}`);
      index += 1;
    } else {
      terms.push(token);
    }
  }
  return terms;
}

function isQueryTerm(token: string): boolean {
  return !QUERY_STOPWORDS.has(token) && !CLOCK_TIME.test(token);
}

function properNouns(tokens: readonly string[]): string[] {
  return tokens.filter((token) =>
    /^[\p{Lu}][\p{Ll}]+$/u.test(token) &&
    searchTokens(token).some(isQueryTerm)
  ).map((token) => token.toLowerCase());
}

export function marketQuery(eventTitle: string): string {
  const tokens = titleTerms(eventTitle);
  const otherTerms = searchTokens(eventTitle)
    .filter((token) => token.length >= MIN_PLAIN_TERM_LENGTH && isQueryTerm(token))
    .map((token, index) => ({ token, index }))
    .sort((left, right) => right.token.length - left.token.length || left.index - right.index)
    .map(({ token }) => token);
  const uniqueTerms = new Map<string, string>();
  for (const term of [...tickerTerms(tokens), ...properNouns(tokens), ...otherTerms]) {
    const key = term.toLowerCase();
    if (!uniqueTerms.has(key)) uniqueTerms.set(key, term);
  }
  return [...uniqueTerms.values()].slice(0, 3).join(" ");
}
