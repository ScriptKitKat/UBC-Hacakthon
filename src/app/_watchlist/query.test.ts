import { describe, expect, it } from "vitest";
import type { WatchlistCard } from "@/shared";
import {
  applyStarToggle,
  endsMeta,
  filterWatchlist,
  isStarred,
  savedAtLabel,
  sinceSavedLabel,
  sinceSavedPoints,
  sortWatchlist,
  todayChangeLabel,
} from "./query";

function card(overrides: Partial<WatchlistCard> = {}): WatchlistCard {
  return {
    eventTicker: "SOL261231",
    eventTitle: "SOL above $200 by Dec 31?",
    contractLabel: "Yes",
    instrumentSymbol: "GEMI-SOL261231-YES",
    category: "Crypto",
    categoryLabel: "Crypto",
    expiryDate: "2026-12-31T22:00:00.000Z",
    endsIn: "ends in 42d",
    imageUrl: null,
    yesCents: 62,
    noCents: 38,
    changePercent: 16.9,
    sparkline: [48, 50, 62],
    tradeable: true,
    savedAt: "2026-11-01T00:00:00.000Z",
    savedYesCents: 48,
    todayPoints: 9,
    status: "live",
    href: "/markets/GEMI-SOL261231-YES?contract=GEMI-SOL261231-YES",
    ...overrides,
  };
}

const now = new Date("2026-11-19T18:00:00.000Z");

describe("watchlist query", () => {
  it("describes the point move since the market was saved", () => {
    expect(sinceSavedPoints(card())).toBe(14);
    expect(sinceSavedLabel(card())).toBe("up 14 since");
    expect(sinceSavedLabel(card({ yesCents: 41, savedYesCents: 49 }))).toBe("down 8 since");
    expect(sinceSavedLabel(card({ yesCents: 20, savedYesCents: 20 }))).toBe("no change since");
    expect(sinceSavedLabel(card({ savedYesCents: null }))).toBeNull();
    expect(savedAtLabel(card())).toBe("Saved at 48% · up 14 since");
    expect(todayChangeLabel(9)).toBe("▲ 9 today");
    expect(todayChangeLabel(-11)).toBe("▼ 11 today");
    expect(todayChangeLabel(0)).toBe("0 today");
    expect(todayChangeLabel(null)).toBeNull();
  });

  it("filters by move, closing soon, and search, and sorts by the biggest move by default", () => {
    const moving = card();
    const closing = card({
      eventTicker: "WXHIGH-NYC",
      eventTitle: "Snow in New York City before Nov 26?",
      categoryLabel: "Weather",
      expiryDate: "2026-11-26T06:00:00.000Z",
      todayPoints: 0,
      yesCents: 18,
      savedYesCents: 20,
    });
    const quiet = card({
      eventTicker: "TECH260101",
      eventTitle: "New flagship AI model released before Jan 1?",
      categoryLabel: "Tech and AI",
      expiryDate: "2027-01-01T22:00:00.000Z",
      todayPoints: 4,
      yesCents: 33,
      savedYesCents: 30,
    });
    const ended = card({ eventTicker: "OLD", eventTitle: "A settled race", status: "settled", todayPoints: null, expiryDate: "2026-11-01T00:00:00.000Z" });
    const all = [quiet, closing, moving, ended];
    expect(filterWatchlist(all, { filter: "moving", search: "", now }).map((item) => item.eventTicker)).toEqual(["SOL261231"]);
    expect(filterWatchlist(all, { filter: "closing", search: "", now }).map((item) => item.eventTicker)).toEqual(["WXHIGH-NYC"]);
    expect(filterWatchlist(all, { filter: "all", search: "snow", now }).map((item) => item.eventTicker)).toEqual(["WXHIGH-NYC"]);
    expect(filterWatchlist(all, { filter: "agent", search: "", now, agentTickers: new Set(["SOL261231"]) }).map((item) => item.eventTicker)).toEqual(["SOL261231"]);
    expect(sortWatchlist(all, "move").map((item) => item.eventTicker)).toEqual(["SOL261231", "TECH260101", "WXHIGH-NYC", "OLD"]);
    expect(sortWatchlist(all, "closing")[0]?.eventTicker).toBe("OLD");
  });

  it("labels end dates and ended or settled markets from live data", () => {
    expect(endsMeta(card(), "America/Chicago")).toBe("Crypto · ends Dec 31");
    expect(endsMeta(card({ status: "ended" }))).toBe("Crypto · Ended");
    expect(endsMeta(card({ status: "settled", categoryLabel: "Economy" }))).toBe("Economy · Settled");
  });

  it("updates the star set immediately and can roll the change back", () => {
    const initial = new Set(["FED261211"]);
    const added = applyStarToggle(initial, ["BTC2611192200", "GEMI-BTC2611192200-YES"], true);
    expect(isStarred(added, ["BTC2611192200"])).toBe(true);
    expect(isStarred(initial, ["BTC2611192200"])).toBe(false);
    const rolled = applyStarToggle(added, ["BTC2611192200", "GEMI-BTC2611192200-YES"], false);
    expect(isStarred(rolled, ["BTC2611192200"])).toBe(false);
    expect(isStarred(rolled, ["FED261211"])).toBe(true);
  });
});
