import { describe, expect, it } from "vitest";
import type { ResearchBrief } from "./research";
import type { BriefLibraryItem } from "./briefs-library";
import {
  authorLine,
  defaultBriefAuthor,
  filterLibraryItems,
  isAgentAuthor,
  leftoverBriefSections,
  librarySectionGroups,
  libraryStats,
  matchesBriefQuery,
  needsRefresh,
  oddsDeltaPoints,
  resolutionFromStatus,
} from "./briefs-library";

const agent = { agentId: "scout-1", name: "Scout", model: "Grok", personality: "Calm analyst" };

const brief: ResearchBrief = {
  symbol: "GEMI-FED261211-MAINTAIN",
  generatedAt: "2026-11-12T18:00:00.000Z",
  headline: "Fed holds: Maintain is priced at 48¢ for YES",
  sections: [
    { title: "How it resolves", body: "YES if the Fed holds." },
    { title: "Case for YES", body: "The market prices Yes at 48%." },
    { title: "What the market thinks", body: "Buying YES costs 48¢." },
    { title: "Sources", body: "" },
  ],
  polishedBy: "template",
};

function item(overrides: Partial<BriefLibraryItem> = {}): BriefLibraryItem {
  return {
    id: "sig-1",
    symbol: brief.symbol,
    title: brief.headline,
    category: "Economics",
    writtenAt: "2026-11-12T18:00:00.000Z",
    author: "desk",
    costCents: 5,
    signature: "sig-1",
    explorerUrl: "https://explorer.solana.com/tx/sig-1?cluster=devnet",
    yesCentsWhenWritten: 48,
    yesCentsNow: 48,
    needsRefresh: false,
    resolved: null,
    marketState: "open",
    eventTitle: "Fed decision in December?",
    contractLabel: "Fed maintains rate",
    brief,
    ...overrides,
  };
}

describe("brief author helpers", () => {
  it("treats missing authors as the desk and objects as agents", () => {
    expect(defaultBriefAuthor(undefined)).toBe("desk");
    expect(isAgentAuthor("desk")).toBe(false);
    expect(isAgentAuthor("you")).toBe(false);
    expect(isAgentAuthor(agent)).toBe(true);
    expect(authorLine(agent)).toBe("Agent Scout · Grok · Calm analyst");
  });
});

describe("stale and resolved mapping", () => {
  it("flags a move of 10 or more points on an open market", () => {
    expect(oddsDeltaPoints(48, 62)).toBe(14);
    expect(needsRefresh(14, null)).toBe(true);
    expect(needsRefresh(9, null)).toBe(false);
    expect(needsRefresh(14, "no")).toBe(false);
    expect(needsRefresh(null, null)).toBe(false);
  });

  it("reads resolved from a settled contract, including an unknown side", () => {
    expect(resolutionFromStatus("active", "open", undefined)).toBeNull();
    expect(resolutionFromStatus("settled", "settled", "no")).toBe("no");
    expect(resolutionFromStatus("settled", "open", undefined)).toBe("unknown");
    expect(resolutionFromStatus("active", "settled", "yes")).toBe("yes");
  });
});

describe("library filters, search and stats", () => {
  const items = [
    item(),
    item({ id: "sig-2", signature: "sig-2", author: agent, needsRefresh: true, yesCentsNow: 62, title: "Scout on Solana" }),
    item({ id: "sig-3", signature: "sig-3", author: "you", resolved: "no", yesCentsNow: 0, brief: { ...brief, headline: "Closed crypto print", sections: [{ title: "How it resolves", body: "Ended." }] } }),
  ];

  it("filters by agents, stale odds, resolved contracts, and title or body text", () => {
    expect(filterLibraryItems(items, "all", "").map((row) => row.id)).toEqual(["sig-1", "sig-2", "sig-3"]);
    expect(filterLibraryItems(items, "agents", "").map((row) => row.id)).toEqual(["sig-2"]);
    expect(filterLibraryItems(items, "refresh", "").map((row) => row.id)).toEqual(["sig-2"]);
    expect(filterLibraryItems(items, "resolved", "").map((row) => row.id)).toEqual(["sig-3"]);
    expect(filterLibraryItems(items, "all", "solana").map((row) => row.id)).toEqual(["sig-2"]);
    expect(filterLibraryItems(items, "all", "Ended").map((row) => row.id)).toEqual(["sig-3"]);
    const first = items.find((row) => row.id === "sig-1");
    expect(first === undefined ? false : matchesBriefQuery(first, "holds")).toBe(true);
  });

  it("counts every brief, the spend, and how many were written by agents", () => {
    expect(libraryStats(items)).toEqual({ count: 3, spentCents: 15, writtenByAgents: 1 });
  });
});

describe("section mapping", () => {
  it("keeps design numbers for present library sections and leaves classic leftovers intact", () => {
    const groups = librarySectionGroups(brief);
    expect(groups.map((group) => [group.number, group.id, group.sections.map((section) => section.title)])).toEqual([
      [1, "resolves", ["How it resolves"]],
      [4, "cases", ["Case for YES"]],
    ]);
    expect(leftoverBriefSections(brief).map((section) => section.title)).toEqual(["What the market thinks"]);
  });
});
