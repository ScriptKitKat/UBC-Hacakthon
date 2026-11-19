import { describe, expect, it } from "vitest";
import { assetDisplayName, formatDeadline, formatMarketWhen, friendlyEventTitle, relativePriceDay } from "./event-title";

const TZ = "America/Chicago";
const now = new Date("2026-11-19T16:00:00.000Z");

describe("friendly event titles", () => {
  it("maps tickers to full names and uses today, tomorrow, or a date", () => {
    expect(friendlyEventTitle("BTC price on November 19", "2026-11-19T22:00:00.000Z", now, TZ)).toBe("Bitcoin price today?");
    expect(friendlyEventTitle("ETH price on November 20", "2026-11-20T22:00:00.000Z", now, TZ)).toBe("Ethereum price tomorrow?");
    expect(friendlyEventTitle("SOL price on November 21", "2026-11-21T22:00:00.000Z", now, TZ)).toBe("Solana price on Nov 21?");
    expect(friendlyEventTitle("Bitcoin price today?", "2026-11-19T22:00:00.000Z", now, TZ)).toBe("Bitcoin price today?");
    expect(friendlyEventTitle("DOGE price", "2026-11-21T18:00:00.000Z", now, TZ)).toBe("Dogecoin price on Nov 21?");
    expect(friendlyEventTitle("ZEC price on November 19", "2026-11-19T22:00:00.000Z", now, TZ)).toBe("Zcash price today?");
    expect(friendlyEventTitle("BTC price today at 12:30pm EST", "2026-11-19T18:30:00.000Z", now, TZ)).toBe("Bitcoin price today at 12:30pm EST?");
  });

  it("falls back to the raw ticker for unknown assets", () => {
    expect(assetDisplayName("BTC")).toBe("Bitcoin");
    expect(assetDisplayName("XYZ")).toBe("XYZ");
    expect(assetDisplayName("ZEC")).toBe("Zcash");
    expect(assetDisplayName("ETHER")).toBe("Ethereum");
    expect(friendlyEventTitle("XYZ price on November 21", "2026-11-21T22:00:00.000Z", now, TZ)).toBe("XYZ price on Nov 21?");
  });

  it("keeps non-price Gemini titles and titles without a usable expiry", () => {
    expect(friendlyEventTitle("Fed decision in December?", "2026-12-11T22:00:00.000Z", now, TZ)).toBe("Fed decision in December?");
    expect(friendlyEventTitle("Will BTC close above 100k this year?", "2026-12-31T22:00:00.000Z", now, TZ)).toBe("Will BTC close above 100k this year?");
    expect(friendlyEventTitle("BTC price on November 19", null, now, TZ)).toBe("BTC price on November 19");
    expect(friendlyEventTitle("BTC price on November 19", "not-a-date", now, TZ)).toBe("BTC price on November 19");
  });

  it("formats the close time in the viewer's zone", () => {
    expect(formatDeadline("2026-11-19T22:00:00.000Z", TZ)).toBe("Closes Nov 19, 4:00 PM CST");
    expect(formatDeadline(undefined, TZ)).toBeNull();
    expect(formatDeadline("nope", TZ)).toBeNull();
    expect(formatMarketWhen("2026-11-19T22:00:00.000Z", now, TZ)).toBe("Today, 4:00 PM");
    expect(formatMarketWhen("2026-11-22T01:00:00.000Z", now, TZ)).toBe("Ends Sat");
    expect(formatMarketWhen("2026-12-10T18:00:00.000Z", now, TZ)).toBe("Dec 10");
  });

  it("counts calendar days in the given timezone, not UTC", () => {
    const evening = new Date("2026-11-20T05:30:00.000Z");
    expect(relativePriceDay(new Date("2026-11-20T05:45:00.000Z"), evening, TZ)).toBe("today?");
    expect(relativePriceDay(new Date("2026-11-20T06:00:00.000Z"), evening, TZ)).toBe("tomorrow?");
  });
});
