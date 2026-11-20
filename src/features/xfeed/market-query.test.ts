import { describe, expect, it } from "vitest";
import { marketQuery } from "./market-query";

describe("marketQuery", () => {
  it("keeps capitalized subjects while dropping question wording and unattached numbers", () => {
    expect(marketQuery("Will Bitcoin be above $100,000 on December 31?")).toBe("bitcoin");
  });

  it("preserves acronym subjects and attaches their following number", () => {
    expect(marketQuery("Will the S&P 500 close higher at year end?")).toBe('"S&P 500" higher close');
  });

  it("prioritizes tickers over proper nouns and other title words", () => {
    expect(marketQuery("Nasdaq/BTC rises?")).toBe("BTC nasdaq rise");
  });

  it("prioritizes a Fed subject in rate-market titles", () => {
    expect(marketQuery("Fed holds rates as inflation cools")).toBe("fed inflation hold");
  });

  it("drops clock times, time zones, and months from intraday crypto titles", () => {
    expect(marketQuery("BTC price today at 7:55am EST")).toBe("BTC");
    expect(marketQuery("Copper price on November 27?")).toBe("copper");
  });

  it("drops matchup and line wording from game titles", () => {
    expect(marketQuery("Oakland vs Purdue")).toBe("oakland purdue");
    expect(marketQuery("Houston vs Denver: Total Points")).toBe("houston denver");
  });

  it("keeps the city and subject of a weather market", () => {
    expect(marketQuery("Highest temperature in Austin on November 20, 2026?")).toBe("austin temperature");
  });

  it("keeps sports subjects and league acronyms", () => {
    expect(marketQuery("Lakers vs Celtics: NBA Finals winner?")).toBe("NBA lakers celtics");
  });

  it("uses matcher stopwords and keeps at most three distinct terms", () => {
    expect(marketQuery("What will the Federal Reserve do in December?")).toBe("federal reserve");
    expect(marketQuery("CPI hotter than expected — November release?")).toBe("CPI expected release");
    expect(marketQuery("Ethereum price today compared with Bitcoin")).toBe("ethereum bitcoin compared");
  });
});
