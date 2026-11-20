import { describe, expect, it } from "vitest";
import { edgeFor } from "./edge";

describe("edgeFor", () => {
  it("picks Yes when the estimate is well above the Yes price", () => {
    expect(edgeFor(70, 55, 47)).toEqual({
      kind: "edge",
      side: "yes",
      priceCents: 55,
      winPercent: 70,
      edgeCents: 15,
      averageCentsPerDollar: 27,
      lossesInTen: 3,
    });
  });

  it("picks No when the estimate is well below the Yes price", () => {
    const result = edgeFor(30, 62, 40);
    expect(result).toMatchObject({ kind: "edge", side: "no", priceCents: 40, winPercent: 70, edgeCents: 30 });
  });

  it("reports no edge when the estimate is close to the price", () => {
    expect(edgeFor(56, 55, 47)).toEqual({ kind: "none" });
  });

  it("reports no edge when both sides cost more than the estimate is worth", () => {
    expect(edgeFor(50, 52, 52)).toEqual({ kind: "none" });
  });

  it("reports a missing price when neither side is quoted", () => {
    expect(edgeFor(50, null, null)).toEqual({ kind: "no-price" });
  });

  it("uses the only quoted side", () => {
    expect(edgeFor(20, null, 60)).toMatchObject({ kind: "edge", side: "no", edgeCents: 20 });
  });

  it("clamps estimates outside 0 to 100", () => {
    expect(edgeFor(140, 90, 12)).toMatchObject({ kind: "edge", side: "yes", winPercent: 100, lossesInTen: 0 });
  });
});
