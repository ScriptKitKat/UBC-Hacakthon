import { describe, expect, it } from "vitest";
import { marketQuery } from "./market-query";

describe("marketQuery", () => {
  it("keeps significant words while dropping question wording, numbers, and punctuation", () => {
    expect(marketQuery("Will Bitcoin be above $100,000 on December 31?")).toBe("december bitcoin");
  });

  it("uses the matcher stopwords for other market titles", () => {
    expect(marketQuery("What will the Federal Reserve do in December?")).toBe("december federal reserve");
    expect(marketQuery("CPI hotter than expected — November release?")).toBe("expected november release");
  });

  it("keeps at most three distinct terms", () => {
    expect(marketQuery("Ethereum price today compared with Bitcoin")).toBe("ethereum compared bitcoin");
  });
});
