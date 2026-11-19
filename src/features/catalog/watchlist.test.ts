import { describe, expect, it } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import { openWatchlist } from "./watchlist";

describe("watchlist", () => {
  it("adds unique symbols and removes them", async () => {
    const watchlist = openWatchlist({ fs: createMemoryFileSystem(), path: "watchlist.json" });
    expect(await watchlist.list()).toEqual([]);
    expect(await watchlist.add("GEMI-FED-YES")).toEqual(["GEMI-FED-YES"]);
    expect(await watchlist.add("GEMI-FED-YES")).toEqual(["GEMI-FED-YES"]);
    expect(await watchlist.add("GEMI-BTC-YES")).toEqual(["GEMI-FED-YES", "GEMI-BTC-YES"]);
    expect(await watchlist.remove("GEMI-FED-YES")).toEqual(["GEMI-BTC-YES"]);
  });
});
