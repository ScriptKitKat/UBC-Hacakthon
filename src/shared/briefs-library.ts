import { z } from "zod";
import { briefAuthorSchema, briefEvidenceSchema } from "./brief-record";
import type { BriefAuthor } from "./brief-record";
import { researchBriefSchema } from "./research";
import type { ResearchBrief } from "./research";

export const LIBRARY_STALE_POINTS = 10;

export const briefLibraryFilterSchema = z.enum(["all", "agents", "refresh", "resolved"]);
export type BriefLibraryFilter = z.output<typeof briefLibraryFilterSchema>;

export const briefResolutionSchema = z.enum(["yes", "no", "unknown"]);
export type BriefResolution = z.output<typeof briefResolutionSchema>;

export const briefLibraryItemSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  title: z.string(),
  category: z.string(),
  writtenAt: z.string(),
  author: briefAuthorSchema,
  costCents: z.number(),
  signature: z.string(),
  explorerUrl: z.string().nullable(),
  yesCentsWhenWritten: z.number().nullable(),
  yesCentsNow: z.number().nullable(),
  needsRefresh: z.boolean(),
  resolved: briefResolutionSchema.nullable(),
  marketState: z.string().nullable(),
  eventTitle: z.string().nullable(),
  contractLabel: z.string().nullable(),
  brief: researchBriefSchema,
});

export const briefLibraryViewSchema = z.object({
  generatedAt: z.string(),
  items: z.array(briefLibraryItemSchema),
  stats: z.object({
    count: z.number(),
    spentCents: z.number(),
    writtenByAgents: z.number(),
  }),
});

export type BriefLibraryItem = z.output<typeof briefLibraryItemSchema>;
export type BriefLibraryView = z.output<typeof briefLibraryViewSchema>;

export const LIBRARY_SECTION_GROUPS = [
  { id: "resolves", number: 1, titles: ["How it resolves"] },
  { id: "numbers", number: 2, titles: ["Key numbers when written"] },
  { id: "moved", number: 3, titles: ["What moved the odds"] },
  { id: "cases", number: 4, titles: ["Case for YES", "Case for NO"] },
  { id: "upcoming", number: 5, titles: ["Upcoming events", "Coming up before it resolves"] },
  { id: "crowd", number: 6, titles: ["Crowd sentiment", "Crowd and sentiment", "Crowd and liquidity"] },
  { id: "history", number: 7, titles: ["History", "History and base rates"] },
  { id: "mind", number: 8, titles: ["What would change the agent's mind", "What would move it"] },
  { id: "sources", number: 9, titles: ["Sources"] },
] as const;

export type LibrarySectionGroupId = (typeof LIBRARY_SECTION_GROUPS)[number]["id"];

export interface LibrarySectionGroup {
  readonly id: LibrarySectionGroupId;
  readonly number: number;
  readonly sections: readonly { readonly title: string; readonly body: string }[];
}

const LIBRARY_TITLES: ReadonlySet<string> = new Set(LIBRARY_SECTION_GROUPS.flatMap((group) => [...group.titles]));

export function isAgentAuthor(author: BriefAuthor): boolean {
  return typeof author === "object";
}

export function defaultBriefAuthor(author: BriefAuthor | undefined): BriefAuthor {
  return author ?? "desk";
}

export function authorLabel(author: BriefAuthor): string {
  if (author === "desk") return "desk";
  if (author === "you") return "you";
  return author.name;
}

export function authorLine(author: BriefAuthor): string {
  if (author === "desk") return "Desk";
  if (author === "you") return "You";
  return `Agent ${author.name} · ${author.model} · ${author.personality}`;
}

export function oddsDeltaPoints(written: number | null, live: number | null): number | null {
  if (written === null || live === null) return null;
  return Math.round(live) - Math.round(written);
}

export function needsRefresh(delta: number | null, resolved: BriefResolution | null): boolean {
  if (resolved !== null || delta === null) return false;
  return Math.abs(delta) >= LIBRARY_STALE_POINTS;
}

export function resolutionFromStatus(
  eventStatus: string,
  contractStatus: string,
  resolutionSide: "yes" | "no" | undefined,
): BriefResolution | null {
  const settled = eventStatus === "settled" || contractStatus === "settled";
  if (resolutionSide === "yes" || resolutionSide === "no") return resolutionSide;
  if (settled) return "unknown";
  return null;
}

export function libraryStats(items: readonly BriefLibraryItem[]): BriefLibraryView["stats"] {
  return {
    count: items.length,
    spentCents: items.reduce((sum, item) => sum + item.costCents, 0),
    writtenByAgents: items.filter((item) => isAgentAuthor(item.author)).length,
  };
}

function authorSearchText(author: BriefAuthor): string {
  if (author === "desk" || author === "you") return author;
  return [author.name, author.model, author.personality, author.agentId].join(" ");
}

export function briefSearchText(item: BriefLibraryItem): string {
  return [
    item.title,
    item.category,
    item.eventTitle ?? "",
    item.contractLabel ?? "",
    authorSearchText(item.author),
    item.brief.headline,
    ...item.brief.sections.flatMap((section) => [section.title, section.body]),
    item.brief.evidence?.bottomLine ?? "",
  ].join("\n").toLowerCase();
}

export function matchesBriefQuery(item: BriefLibraryItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || briefSearchText(item).includes(needle);
}

export function filterLibraryItems(
  items: readonly BriefLibraryItem[],
  filter: BriefLibraryFilter,
  query: string,
): BriefLibraryItem[] {
  return items.filter((item) => {
    if (filter === "agents" && !isAgentAuthor(item.author)) return false;
    if (filter === "refresh" && !item.needsRefresh) return false;
    if (filter === "resolved" && item.resolved === null) return false;
    return matchesBriefQuery(item, query);
  });
}

export function librarySectionGroups(brief: ResearchBrief): readonly LibrarySectionGroup[] {
  const byTitle = new Map(brief.sections.map((section) => [section.title, section]));
  return LIBRARY_SECTION_GROUPS.flatMap((group) => {
    const sections = group.titles.flatMap((title) => {
      const section = byTitle.get(title);
      return section === undefined || section.body.trim() === "" ? [] : [section];
    });
    return sections.length === 0 ? [] : [{ id: group.id, number: group.number, sections }];
  });
}

export function leftoverBriefSections(brief: ResearchBrief): ResearchBrief["sections"] {
  return brief.sections.filter((section) => section.body.trim() !== "" && !LIBRARY_TITLES.has(section.title));
}

export { briefAuthorSchema, briefEvidenceSchema };
export type { BriefAuthor, BriefEvidence } from "./brief-record";
