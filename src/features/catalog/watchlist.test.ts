import { describe, expect, it } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import {
  itemFromIdentifier,
  openWatchlist,
  resolveWatchlistWrite,
  watchlistIdentifiers,
} from "./watchlist";

describe("watchlist", () => {
  it("adds unique symbols and removes them", async () => {
    const watchlist = openWatchlist({
      fs: createMemoryFileSystem(),
      path: "watchlist.json",
      now: () => new Date("2026-11-19T20:00:00.000Z"),
    });
    expect(await watchlist.list()).toEqual([]);
    expect(await watchlist.add("GEMI-FED-YES")).toEqual([
      { eventTicker: "FED", instrumentSymbol: "GEMI-FED-YES", savedAt: "2026-11-19T20:00:00.000Z", savedYesCents: null },
    ]);
    expect(await watchlist.add("GEMI-FED-YES")).toEqual([
      { eventTicker: "FED", instrumentSymbol: "GEMI-FED-YES", savedAt: "2026-11-19T20:00:00.000Z", savedYesCents: null },
    ]);
    expect((await watchlist.add("GEMI-BTC-YES")).map((item) => item.eventTicker)).toEqual(["FED", "BTC"]);
    expect((await watchlist.remove("GEMI-FED-YES")).map((item) => item.eventTicker)).toEqual(["BTC"]);
  });

  it("stores the yes percent and time when a market is saved", async () => {
    const watchlist = openWatchlist({
      fs: createMemoryFileSystem(),
      path: "watchlist.json",
      now: () => new Date("2026-11-19T20:05:00.000Z"),
    });
    const items = await watchlist.add({ eventTicker: "BTC2611192200", contract: "GEMI-BTC2611192200-YES", yesCents: 62 });
    expect(items).toEqual([
      {
        eventTicker: "BTC2611192200",
        instrumentSymbol: "GEMI-BTC2611192200-YES",
        savedAt: "2026-11-19T20:05:00.000Z",
        savedYesCents: 62,
      },
    ]);
    expect(await watchlist.list()).toEqual(["BTC2611192200", "GEMI-BTC2611192200-YES"]);
  });

  it("treats an event ticker and its contract as the same saved market", async () => {
    const watchlist = openWatchlist({ fs: createMemoryFileSystem(), path: "watchlist.json" });
    await watchlist.add({ eventTicker: "BTC2611192200", yesCents: 50 });
    expect((await watchlist.add({ contract: "GEMI-BTC2611192200-YES", yesCents: 55 })).length).toBe(1);
    expect((await watchlist.remove("GEMI-BTC2611192200-YES")).length).toBe(0);
  });

  it("migrates a legacy symbols file without inventing a saved percent", async () => {
    const fs = createMemoryFileSystem();
    await fs.writeTextAtomic("watchlist.json", JSON.stringify({ symbols: ["GEMI-FED-YES", "WXHIGH-LA"] }));
    const watchlist = openWatchlist({ fs, path: "watchlist.json" });
    expect(await watchlist.items()).toEqual([
      { eventTicker: "FED", instrumentSymbol: "GEMI-FED-YES", savedAt: null, savedYesCents: null },
      { eventTicker: "WXHIGH-LA", instrumentSymbol: null, savedAt: null, savedYesCents: null },
    ]);
  });

  it("serializes concurrent writes so both adds survive", async () => {
    const watchlist = openWatchlist({ fs: createMemoryFileSystem(), path: "watchlist.json" });
    const [left, right] = await Promise.all([
      watchlist.add({ eventTicker: "SOL261231", yesCents: 48 }),
      watchlist.add({ eventTicker: "BTC261231", yesCents: 39 }),
    ]);
    const tickers = new Set([...left, ...right].map((item) => item.eventTicker));
    expect([...tickers].sort()).toEqual(["BTC261231", "SOL261231"]);
    expect((await watchlist.items()).map((item) => item.eventTicker).sort()).toEqual(["BTC261231", "SOL261231"]);
  });

  it("resolves add and remove keys from a contract, event ticker, or generic symbol", () => {
    expect(resolveWatchlistWrite("GEMI-FED261211-MAINTAIN")).toEqual({
      eventTicker: "FED261211",
      instrumentSymbol: "GEMI-FED261211-MAINTAIN",
      savedAt: null,
      savedYesCents: null,
    });
    expect(resolveWatchlistWrite({ eventTicker: "FED261211", yesCents: 41 })).toMatchObject({
      eventTicker: "FED261211",
      instrumentSymbol: null,
      savedYesCents: 41,
    });
    expect(resolveWatchlistWrite({ contract: "GEMI-BTC2611192200-YES" })?.eventTicker).toBe("BTC2611192200");
    expect(resolveWatchlistWrite("   ")).toBeUndefined();
    expect(itemFromIdentifier("GEMI-FED-YES")?.eventTicker).toBe("FED");
    expect(watchlistIdentifiers([
      { eventTicker: "FED", instrumentSymbol: "GEMI-FED-YES", savedAt: null, savedYesCents: null },
    ])).toEqual(["FED", "GEMI-FED-YES"]);
  });
});
