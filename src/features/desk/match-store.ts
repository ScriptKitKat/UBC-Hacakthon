import { z } from "zod";
import { createJsonStore } from "@/features/storage";
import type { FileSystem } from "@/features/storage";
import type { ResearchPostContext } from "@/shared";

const MATCH_LIMIT = 2000;

const storedMatchSchema = z.object({
  postId: z.string(),
  symbols: z.array(z.string()).min(1),
  source: z.enum(["x-feed", "news"]),
  text: z.string(),
  author: z.string().nullable(),
  url: z.string().nullable(),
  why: z.string().nullable(),
  atMs: z.number(),
});

const fileSchema = z.object({ version: z.literal(1), matches: z.array(storedMatchSchema) });

export type StoredMatch = z.output<typeof storedMatchSchema>;

export interface MatchPersistence {
  readonly initialMatches: readonly StoredMatch[];
  readonly saveMatches: (matches: readonly StoredMatch[]) => Promise<void>;
}

export function matchToContext(match: StoredMatch): ResearchPostContext {
  return { source: match.source, text: match.text, author: match.author, url: match.url, why: match.why, atMs: match.atMs };
}

export function capMatches(matches: readonly StoredMatch[]): StoredMatch[] {
  return [...matches]
    .sort((left, right) => right.atMs - left.atMs)
    .filter((match, index, list) => list.findIndex((other) => other.postId === match.postId) === index)
    .slice(0, MATCH_LIMIT);
}

export async function openMatchStore(options: { readonly fs: FileSystem; readonly path: string }): Promise<MatchPersistence> {
  const file = createJsonStore({ fs: options.fs, path: options.path, schema: fileSchema, empty: () => ({ version: 1 as const, matches: [] }) });
  const loaded = await file.load();
  return {
    initialMatches: capMatches(loaded.matches),
    saveMatches: (matches) => file.save({ version: 1, matches: capMatches(matches) }),
  };
}
