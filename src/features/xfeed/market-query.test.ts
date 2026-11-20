import { describe, expect, it } from "vitest";
import { marketQuery } from "./market-query";

describe("marketQuery", () => {
  it("keeps capitalized subjects while dropping question wording and unattached numbers", () => {
    expect(marketQuery("Will Bitcoin be above $100,000 on December 31?")).toBe("Bitcoin December");
  });

  it("preserves acronym subjects and attaches their following number", () => {
    expect(marketQuery("Will the S&P 500 close higher at year end?")).toBe('"S&P 500" higher close');
  });

  it("prioritizes tickers over proper nouns and other title words", () => {
    expect(marketQuery("Nasdaq/BTC rises?")).toBe("BTC Nasdaq rise");
  });

  it("prioritizes a Fed subject in rate-market titles", () => {
    expect(marketQuery("Fed holds rates as inflation cools")).toBe("Fed inflation hold");
  });

  it("keeps sports subjects and league acronyms", () => {
    expect(marketQuery("Lakers vs Celtics: NBA Finals winner?")).toBe("NBA Lakers Celtics");
  });

  it("uses matcher stopwords and keeps at most three distinct terms", () => {
    expect(marketQuery("What will the Federal Reserve do in December?")).toBe("Federal Reserve December");
    expect(marketQuery("CPI hotter than expected — November release?")).toBe("CPI November expected");
    expect(marketQuery("Ethereum price today compared with Bitcoin")).toBe("Ethereum Bitcoin compared");
  });
});
