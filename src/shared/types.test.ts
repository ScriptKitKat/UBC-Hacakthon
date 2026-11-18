import { describe, expect, it } from "vitest";
import { instrumentSymbol, usdCents } from "@/shared";

describe("usdCents", () => {
  it("accepts non-negative integers", () => {
    expect(usdCents(0)).toBe(0);
    expect(usdCents(250)).toBe(250);
  });

  it.each([1.5, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (value) => {
    expect(() => usdCents(value)).toThrow(RangeError);
  });
});

describe("instrumentSymbol", () => {
  it("rejects empty strings", () => {
    expect(() => instrumentSymbol("")).toThrow(RangeError);
  });
});
