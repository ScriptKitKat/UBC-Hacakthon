import { describe, expect, it } from "vitest";
import { normalizeHandle } from "./handles";

describe("normalizeHandle", () => {
  it.each([
    ["priscilla", "@priscilla"],
    ["@Priscilla", "@priscilla"],
    ["  @@PRISCILLA ", "@priscilla"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeHandle(raw)).toBe(expected);
  });
});
