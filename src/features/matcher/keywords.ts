const ALIASES: readonly (readonly [phrase: string, keyword: string])[] = [
  ["bitcoin", "btc"],
  ["ethereum", "eth"],
  ["federal reserve", "fed"],
  ["fomc", "fed"],
  ["powell", "fed"],
  ["rate cut", "fed"],
  ["cut rates", "fed"],
  ["rate hike", "fed"],
  ["hike rates", "fed"],
  ["raise rates", "fed"],
  ["interest rate", "fed"],
];

const STOPWORDS: ReadonlySet<string> = new Set(
  (
    "a an and are as at be been but by for from has have he her his how if in into is it its of on or our " +
    "she so than that the their them then there these they this to up was we were what when where which who " +
    "will with would you your after before about over under just not no new says said say amid via"
  ).split(" "),
);

const MIN_TOKEN_LENGTH = 2;
const MAX_SEARCH_KEYWORDS = 3;

export interface NewsProfile {
  readonly tokens: ReadonlySet<string>;
  readonly aliasKeywords: ReadonlySet<string>;
  readonly searchKeywords: readonly string[];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stem(token: string): string {
  return token.length > 3 && token.endsWith("s") && !token.endsWith("ss") && !/\d/.test(token)
    ? token.slice(0, -1)
    : token;
}

function plainTokens(normalized: string): string[] {
  return normalized
    .split(" ")
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token))
    .map(stem);
}

function stemAll(normalized: string): string {
  return normalized.split(" ").map(stem).join(" ");
}

const ALIAS_KEYWORDS: ReadonlySet<string> = new Set(ALIASES.map(([, keyword]) => keyword));

function aliasKeywordsIn(normalized: string): string[] {
  const stemmed = stemAll(normalized);
  const padded = ` ${stemmed} `;
  const fromPhrases = ALIASES.filter(([phrase]) => padded.includes(` ${stemAll(phrase)} `)).map(([, keyword]) => keyword);
  const literal = stemmed.split(" ").filter((token) => ALIAS_KEYWORDS.has(token));
  return [...new Set([...fromPhrases, ...literal])];
}

export function marketTextTokens(text: string): ReadonlySet<string> {
  const normalized = normalize(text);
  return new Set([...plainTokens(normalized), ...aliasKeywordsIn(normalized)]);
}

export function searchTokens(text: string): readonly string[] {
  return plainTokens(normalize(text)).filter((token) => !/^\d+$/u.test(token));
}

export function profileNews(text: string): NewsProfile {
  const normalized = normalize(text);
  const aliasKeywords = aliasKeywordsIn(normalized);
  const tokens = [...new Set(plainTokens(normalized))];
  const byLengthDescending = tokens
    .map((token, index) => ({ token, index }))
    .sort((a, b) => b.token.length - a.token.length || a.index - b.index)
    .map(({ token }) => token);
  const searchKeywords = [...new Set([...aliasKeywords, ...byLengthDescending])].slice(0, MAX_SEARCH_KEYWORDS);
  return {
    tokens: new Set([...tokens, ...aliasKeywords]),
    aliasKeywords: new Set(aliasKeywords),
    searchKeywords,
  };
}
