import { describe, expect, it } from "vitest";
import { defaultAgent } from "./store";
import { crossedLevel, evaluateTriggers, hoursToExpiry, isMondayInZone, todayPoints, volumeMultiple, type MarketSnapshot } from "./triggers";
import { DEFAULT_TRIGGERS, type AgentRecord } from "./types";

const NOW = new Date("2026-11-19T18:00:00.000Z");

function agent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return { ...defaultAgent({ eventTicker: "BTC", instrumentSymbol: "GEMI-BTC-YES" }, NOW), ...overrides };
}

function snap(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    yesCents: 55,
    yesCents24hAgo: 40,
    volume24h: 400,
    volumeTotal: 1000,
    createdAt: "2026-11-09T18:00:00.000Z",
    expiryDate: "2026-11-21T12:00:00.000Z",
    ...overrides,
  };
}

describe("trigger math", () => {
  it("treats a 5 point day move as an odds move", () => {
    expect(todayPoints({ yesCents: 55, yesCents24hAgo: 50 })).toBe(5);
    expect(todayPoints({ yesCents: 44, yesCents24hAgo: 50 })).toBe(-6);
    expect(todayPoints({ yesCents: 50, yesCents24hAgo: null })).toBeNull();
  });

  it("computes volume versus the market's own prior daily average", () => {
    expect(volumeMultiple(snap(), NOW)).toBeCloseTo(400 / (600 / 9), 6);
    expect(volumeMultiple(snap({ volumeTotal: 400 }), NOW)).toBeNull();
    expect(volumeMultiple(snap({ createdAt: null }), NOW)).toBeNull();
  });

  it("detects a level cross and hours to expiry", () => {
    expect(crossedLevel(48, 52, 50)).toBe(true);
    expect(crossedLevel(52, 48, 50)).toBe(true);
    expect(crossedLevel(51, 60, 50)).toBe(false);
    expect(crossedLevel(48, 49, 50)).toBe(false);
    expect(crossedLevel(48, 52, null)).toBe(false);
    expect(hoursToExpiry(snap({ expiryDate: "2026-11-20T18:00:00.000Z" }), NOW)).toBe(24);
    expect(hoursToExpiry(snap({ expiryDate: "2026-11-18T18:00:00.000Z" }), NOW)).toBeNull();
  });

  it("knows Monday in America/Chicago", () => {
    expect(isMondayInZone(new Date("2026-11-16T18:00:00.000Z"))).toBe(true);
    expect(isMondayInZone(NOW)).toBe(false);
  });
});

describe("evaluateTriggers", () => {
  it("fires odds, volume, and ending-soon when the market moves enough", () => {
    const result = evaluateTriggers(agent(), snap({ expiryDate: "2026-11-20T18:00:00.000Z" }), NOW);
    expect(result.fired).toEqual(["oddsMove", "volumeSpike", "endingSoon"]);
    expect(result.todayPoints).toBe(15);
  });

  it("skips X mention and breaking news triggers with needs X feed", () => {
    const result = evaluateTriggers(agent({ triggers: { ...DEFAULT_TRIGGERS, xMentions: true, breakingNews: true } }), snap(), NOW);
    expect(result.skipped).toEqual([
      { id: "xMentions", reason: "needs X feed" },
      { id: "breakingNews", reason: "needs X feed" },
    ]);
    expect(result.fired.includes("xMentions")).toBe(false);
  });

  it("fires an odds-cross when the yes price crosses the set level", () => {
    const result = evaluateTriggers(
      agent({ triggers: { ...DEFAULT_TRIGGERS, oddsMove: false, volumeSpike: false, endingSoon: false, oddsCross: true, oddsCrossLevel: 50 } }),
      snap({ yesCents: 52, yesCents24hAgo: 48, volume24h: 0, volumeTotal: 10 }),
      NOW,
    );
    expect(result.fired).toEqual(["oddsCross"]);
  });

  it("does not re-fire a cooled-down odds move", () => {
    const result = evaluateTriggers(
      agent({ lastTriggerAt: { oddsMove: "2026-11-19T14:00:00.000Z" }, triggers: { ...DEFAULT_TRIGGERS, volumeSpike: false, endingSoon: false } }),
      snap(),
      NOW,
    );
    expect(result.fired).toEqual([]);
    expect(result.skipped).toEqual([{ id: "oddsMove", reason: "already reported this move" }]);
  });

  it("fires brief triggers only when writeBriefs is on", () => {
    const market = snap({ yesCents: 62, yesCents24hAgo: 50, expiryDate: "2026-11-20T18:00:00.000Z" });
    const off = evaluateTriggers(agent({ writeBriefs: false }), market, NOW);
    expect(off.fired.filter((id) => id.startsWith("brief"))).toEqual([]);
    const on = evaluateTriggers(agent({ writeBriefs: true }), market, NOW);
    expect(on.fired).toEqual(expect.arrayContaining(["briefOddsMove10", "briefEndingSoon"]));
    const monday = evaluateTriggers(
      agent({ writeBriefs: true, briefTriggers: { oddsMove10: false, everyMonday: true, endingSoon: false }, triggers: { ...DEFAULT_TRIGGERS, oddsMove: false, volumeSpike: false, endingSoon: false } }),
      snap({ yesCents: 50, yesCents24hAgo: 50, volume24h: 0 }),
      new Date("2026-11-16T18:00:00.000Z"),
    );
    expect(monday.fired).toEqual(["briefMonday"]);
  });
});
