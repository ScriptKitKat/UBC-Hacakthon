import { describe, expect, it } from "vitest";
import type { DecisionLogEntry, MarketView, MatchView, PolicyView } from "@/shared";
import { composeDecisionReply, composeNewsReply, composeStatusReply } from "./compose-reply";
import { TWEET_LIMIT } from "./tweet";

const policy: PolicyView = {
  dailyCapCents: 2000,
  spentCents: 300,
  researchSpentCents: 0,
  remainingCents: 1700,
  autoApproveMaxCents: 200,
  perTradeMaxCents: 1000,
  killSwitch: false,
  marketAllowlist: [],
  marketCategories: [],
  senderAllowlist: [],
};

const BET_LINE = "Reply 'yes 2' or 'no 2' to bet $2 USDC (paper Gemini ticket, Solana test USDC)";

function matched(overrides: Partial<MarketView> = {}): Extract<MatchView, { kind: "matched" }> {
  return {
    kind: "matched",
    reasons: [],
    market: {
      eventTicker: "FED261211",
      eventTitle: "Fed decision in December?",
      contractLabel: "Fed maintains rate",
      instrumentSymbol: "GEMI-FED261211-MAINTAIN",
      yesCents: 62,
      noCents: 40,
      marketState: "open",
      ...overrides,
    },
  };
}

function entry(overrides: Partial<DecisionLogEntry>): DecisionLogEntry {
  return {
    entryId: "e1",
    kind: "approve",
    spokenReason: "Approved $2.00 on YES.",
    intentId: "i1",
    symbol: "GEMI-FED261211-MAINTAIN",
    outcome: "yes",
    notionalCents: 200,
    senderId: "@priscilla",
    source: "x",
    at: "2026-11-17T12:00:00.000Z",
    ...overrides,
  };
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const SYMBOLS = Array.from("abcdefghij klmnop—¢😀éü ");

function randomText(random: () => number, length: number): string {
  return Array.from({ length }, () => SYMBOLS[Math.floor(random() * SYMBOLS.length)] ?? "a").join("");
}

describe("composeNewsReply", () => {
  it("includes the market, both odds, the budget and the bet instruction", () => {
    expect(composeNewsReply(matched(), policy)).toBe(
      [
        "Fed decision in December? — Fed maintains rate",
        "Yes 62¢ · No 40¢",
        "Daily budget left: $17.00",
        BET_LINE,
      ].join("\n"),
    );
  });

  it("renders missing odds as a dash", () => {
    expect(composeNewsReply(matched({ yesCents: null, noCents: null }), policy)).toContain("Yes — · No —");
  });

  it("clips CJK titles to the weighted tweet limit", () => {
    const text = composeNewsReply(matched({ eventTitle: "界".repeat(TWEET_LIMIT) }), policy);
    expect(text.length + Array.from(text).filter((character) => character === "界").length).toBeLessThanOrEqual(TWEET_LIMIT);
    expect(text).toContain(BET_LINE);
  });

  it("never exceeds the tweet limit and keeps the actionable lines for any title length", () => {
    const random = seededRandom(7);
    for (let run = 0; run < 300; run += 1) {
      const eventTitle = randomText(random, Math.floor(random() * 900));
      const contractLabel = randomText(random, Math.floor(random() * 400));
      const remainingCents = Math.floor(random() * 1e12);
      const text = composeNewsReply(matched({ eventTitle, contractLabel }), { ...policy, remainingCents });
      expect(text.length).toBeLessThanOrEqual(TWEET_LIMIT);
      expect(text).toContain("Yes 62¢ · No 40¢");
      expect(text).toContain(BET_LINE);
      expect(text.isWellFormed()).toBe(true);
    }
  });
});

describe("composeDecisionReply", () => {
  it("adds ticket and transaction proof on a fill", () => {
    const text = composeDecisionReply(
      entry({
        signature: "5KtPn1LGuxhFiwjxErkxTb9Jj6x9WZ1hYJp2",
        explorerUrl: "https://explorer.test/tx/5KtPn1",
        ticket: { ticketId: "abcdef1234567890", symbol: "S", outcome: "yes", quantity: "3", price: "62", mode: "paper" },
      }),
    );
    expect(text).toBe("Approved $2.00 on YES.\nPaper ticket abcdef12 · tx 5KtPn1LG…YJp2 · https://explorer.test/tx/5KtPn1");
  });

  it("asks the original sender to approve when approval is needed", () => {
    const text = composeDecisionReply(entry({ kind: "needs-approval", spokenReason: "That needs approval." }));
    expect(text).toContain("That needs approval.");
    expect(text).toContain("\"approve\"");
  });

  it("passes refusals through unchanged", () => {
    expect(composeDecisionReply(entry({ kind: "refuse", spokenReason: "Kill switch is on." }))).toBe("Kill switch is on.");
  });

  it("reserves room for a short URL at X’s fixed link length", () => {
    const url = "https://x.co";
    const text = composeDecisionReply(entry({ spokenReason: "x".repeat(TWEET_LIMIT), explorerUrl: url }));
    expect(text).toContain(url);
    expect(text.length + 23 - url.length + 1).toBeLessThanOrEqual(TWEET_LIMIT);
  });

  it("stays within the tweet limit for long reasons while keeping the proof", () => {
    const text = composeDecisionReply(
      entry({ spokenReason: "x".repeat(600), signature: "s".repeat(88), explorerUrl: `https://explorer.test/tx/${"s".repeat(88)}` }),
    );
    expect(text.length).toBeLessThanOrEqual(TWEET_LIMIT);
    expect(text).toContain("https://explorer.test/tx/");
  });
});

describe("composeStatusReply", () => {
  it("reports remaining budget, spent and pending count", () => {
    expect(composeStatusReply(policy, 2)).toBe("Budget left $17.00; spent $3.00 of $20.00 today; 2 pending approval.");
  });
});
