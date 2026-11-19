import { describe, expect, it } from "vitest";
import { selectedResearchSymbol } from "./research-symbol";

describe("selectedResearchSymbol", () => {
  it("uses the contract query when present and falls back to the path symbol", () => {
    expect(selectedResearchSymbol("GEMI-BTC-HI61500", "GEMI-BTC-HI63000")).toBe("GEMI-BTC-HI63000");
    expect(selectedResearchSymbol("GEMI-BTC-HI61500", "  ")).toBe("GEMI-BTC-HI61500");
    expect(selectedResearchSymbol("GEMI-BTC-HI61500", undefined)).toBe("GEMI-BTC-HI61500");
  });
});
