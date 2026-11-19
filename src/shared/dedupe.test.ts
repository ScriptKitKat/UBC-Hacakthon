import { describe, expect, it } from "vitest";
import { mergeByKeyKeepNewest, uniqueByKey } from "./dedupe";

describe("uniqueByKey", () => {
  it("keeps the first occurrence and drops later duplicates", () => {
    const items = [
      { id: "A", n: 1 },
      { id: "B", n: 2 },
      { id: "A", n: 3 },
      { id: "C", n: 4 },
      { id: "B", n: 5 },
    ];
    expect(uniqueByKey(items, (item) => item.id)).toEqual([
      { id: "A", n: 1 },
      { id: "B", n: 2 },
      { id: "C", n: 4 },
    ]);
  });
});

describe("mergeByKeyKeepNewest", () => {
  it("keeps existing order, updates overlapping keys, and appends new ones", () => {
    const existing = [
      { id: "XAU2611192200", vol: 1 },
      { id: "BTC2611192000", vol: 2 },
      { id: "ZEC2611192200", vol: 3 },
    ];
    const incoming = [
      { id: "BTC2611192000", vol: 20 },
      { id: "WXHIGH-LA-2611200459", vol: 4 },
      { id: "XAU2611192200", vol: 10 },
    ];
    expect(mergeByKeyKeepNewest(existing, incoming, (item) => item.id)).toEqual([
      { id: "XAU2611192200", vol: 10 },
      { id: "BTC2611192000", vol: 20 },
      { id: "ZEC2611192200", vol: 3 },
      { id: "WXHIGH-LA-2611200459", vol: 4 },
    ]);
  });

  it("removes Load more overlap so React keys stay unique", () => {
    const firstPage = ["XAU2611192200", "BTC2611192000", "ZEC2611192200", "WXHIGH-LA-2611200459"].map((id) => ({ id, page: 1 }));
    const secondPage = ["BTC2611192000", "ZEC2611192200", "WXHIGH-SAT-2611200459", "BTC05M2611191920"].map((id) => ({ id, page: 2 }));
    const merged = mergeByKeyKeepNewest(firstPage, secondPage, (item) => item.id);
    expect(merged.map((item) => item.id)).toEqual([
      "XAU2611192200",
      "BTC2611192000",
      "ZEC2611192200",
      "WXHIGH-LA-2611200459",
      "WXHIGH-SAT-2611200459",
      "BTC05M2611191920",
    ]);
    expect(merged.find((item) => item.id === "BTC2611192000")?.page).toBe(2);
    expect(new Set(merged.map((item) => item.id)).size).toBe(merged.length);
  });
});
