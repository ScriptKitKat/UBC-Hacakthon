import { searchTokens } from "@/features/matcher";

const QUERY_STOPWORDS = new Set(["above", "below", "many", "much", "price", "today", "tomorrow", "why"]);

export function marketQuery(eventTitle: string): string {
  const ranked = searchTokens(eventTitle)
    .filter((token) => !QUERY_STOPWORDS.has(token))
    .map((token, index) => ({ token, index }))
    .sort((left, right) => right.token.length - left.token.length || left.index - right.index)
    .map(({ token }) => token);
  return [...new Set(ranked)].slice(0, 3).join(" ");
}
