import { describe, expect, it } from "vitest";
import { describeParameters } from "./voice-transcript";

describe("describeParameters", () => {
  it("lists the tool arguments", () => {
    expect(describeParameters({ outcome: "yes", amount_usd: 2 })).toBe('outcome="yes" amount_usd=2');
  });

  it("is empty for missing or non-object arguments", () => {
    expect(describeParameters(undefined)).toBe("");
    expect(describeParameters(null)).toBe("");
    expect(describeParameters("x")).toBe("");
    expect(describeParameters({})).toBe("");
  });
});
