import { describe, expect, it } from "vitest";
import type { ResearchBrief, ResearchPostContext, ResearchSeriesPoint, ResearchView } from "@/shared";
import {
  crowdMoves,
  crowdSentence,
  dayChangeCents,
  formatEndLine,
  isBeginnerTimeframe,
  marketDrivers,
  marketTitle,
  parseResolution,
  safeHttpsUrl,
  trustOdds,
  volumeLabel,
  yesCentsFromBrief,
  briefStaleCopy,
} from "./beginner";
import { needsApprovalNote, overTradeLimitMessage, tradeCapCents } from "./stake";
import type { TradeBudget } from "./stake";

const NOW = Date.parse("2026-11-19T19:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function point(t: number, cents: number, volume: number | null = 1): ResearchSeriesPoint {
  return { t, cents, volume, source: "gemini", bidCents: null, askCents: null, ma: null, upper: null, lower: null };
}

function baseView(overrides: Partial<ResearchView> & { market?: Partial<ResearchView["market"]>; indicators?: Partial<ResearchView["indicators"]>; prices?: Partial<ResearchView["market"]["prices"]> } = {}): ResearchView {
  const market: ResearchView["market"] = {
    eventTicker: "SOL261231",
    eventTitle: "SOL price on December 31",
    contractLabel: "Above $200",
    category: "Crypto",
    subcategory: null,
    expiryDate: "2027-01-01T05:59:00.000Z",
    eventStatus: "active",
    marketState: "open",
    rulesText: "This market resolves to Yes if the Solana price is strictly above $200.00 at 11:59 pm ET on December 31, 2026. The settlement price is the Gemini SOLUSD index.",
    imageUrl: "https://assets.gemini.com/predictions/images/sol.png",
    termsLink: "https://assets.gemini.com/predictions/terms_and_conditions/sol.pdf",
    volume: 84000,
    volume24h: 2100,
    quantityLimits: null,
    prices: {
      buyYesCents: 62,
      buyNoCents: 39,
      sellYesCents: 60,
      sellNoCents: 38,
      bestBidCents: 60,
      bestAskCents: 62,
      lastTradeCents: 61,
      ...overrides.prices,
    },
    ...overrides.market,
  };
  return {
    symbol: "GEMI-SOL261231-ABOVE200",
    generatedAt: "2026-11-19T19:00:00.000Z",
    timeframe: "1D",
    data: { event: "live", candles: "live", book: "live", trades: "live" },
    series: { source: "gemini", points: [] },
    book: { bids: [], asks: [] },
    trades: [],
    related: { sameEvent: [], sameCategory: [] },
    postContext: null,
    matchedPosts: [],
    ...overrides,
    market,
    indicators: {
      momentum: { value: null, zone: null, reading: "" },
      jumpiness: { value: 4.2, mean: 3, upper: 8, lower: 1, outsideBand: false, reading: "Typical movement." },
      volumeSpike: { ratio: null, obvTrend: null, reading: "" },
      averagePrice: { value: 57, window: 20, reading: "" },
      recentMove: { hourCents: 1, dayCents: 9, reading: "Up 9 cents on the day." },
      ...overrides.indicators,
    },
  };
}

describe("beginner timeframes", () => {
  it("hides 1H from the beginner tabs and includes 1M", () => {
    expect(isBeginnerTimeframe("1M")).toBe(true);
    expect(isBeginnerTimeframe("1D")).toBe(true);
    expect(isBeginnerTimeframe("1H")).toBe(false);
  });
});

describe("crowdSentence", () => {
  it("uses the live Yes price and yesterday's derived price, not invented copy", () => {
    const view = baseView();
    expect(dayChangeCents(view)).toBe(9);
    expect(marketTitle(view, new Date(NOW))).toMatch(/Solana price/i);
    expect(crowdSentence(view, new Date(NOW))).toBe(
      "The crowd thinks there's a 62% chance Solana price on Dec 31. That's up from 53% yesterday.",
    );
  });

  it("omits the sentence when Gemini has no Yes price", () => {
    expect(crowdSentence(baseView({ prices: { buyYesCents: null, buyNoCents: 40, sellYesCents: null, sellNoCents: 38, bestBidCents: null, bestAskCents: null, lastTradeCents: null } }))).toBeNull();
  });

  it("says unchanged when the day change is zero", () => {
    expect(crowdSentence(baseView({ indicators: { recentMove: { hourCents: 0, dayCents: 0, reading: "" } } as ResearchView["indicators"] }), new Date(NOW))).toContain("unchanged from yesterday");
  });
});

describe("header facts", () => {
  it("formats the end time in Chicago time and hides volume when Gemini omitted it", () => {
    const line = formatEndLine("2026-12-31T04:59:00.000Z", NOW);
    expect(line.ends).toMatch(/^Ends Dec 3[0-1]/);
    expect(line.daysLeft).toMatch(/days left/);
    expect(volumeLabel(84000)).toBe("$84k vol.");
    expect(volumeLabel(null)).toBeNull();
  });
});

describe("parseResolution", () => {
  it("extracts the Yes condition and price source from real rules text", () => {
    const parsed = parseResolution(
      "This market resolves to Yes if the Solana price is strictly above $200.00 at 11:59 pm ET on December 31, 2026. The settlement price is the Gemini SOLUSD index.",
      "https://assets.gemini.com/predictions/terms_and_conditions/sol.pdf",
    );
    expect(parsed.yesIf).toBe("the Solana price is strictly above $200.00 at 11:59 pm ET on December 31, 2026");
    expect(parsed.priceSource).toBe("the Gemini SOLUSD index");
    expect(parsed.payout).toContain("$1 per contract");
    expect(parsed.caveat).toMatch(/exact time/);
    expect(parsed.rulesUrl).toBe("https://assets.gemini.com/predictions/terms_and_conditions/sol.pdf");
  });

  it("does not invent a Yes condition or a Gemini-looking rules link", () => {
    const parsed = parseResolution("Traders may buy Yes or No contracts.", "https://evil.example/rules.pdf");
    expect(parsed.yesIf).toBeNull();
    expect(parsed.priceSource).toBeNull();
    expect(parsed.rulesUrl).toBeNull();
    expect(parsed.caveat).toMatch(/short reading/);
  });

  it("only accepts https Gemini asset URLs", () => {
    expect(safeHttpsUrl("https://assets.gemini.com/predictions/images/sol.png")).not.toBeNull();
    expect(safeHttpsUrl("http://assets.gemini.com/predictions/images/sol.png")).toBeNull();
    expect(safeHttpsUrl("https://example.com/sol.png")).toBeNull();
  });
});

describe("crowdMoves", () => {
  it("records sizable Yes moves from the candle series and labels them as price history", () => {
    const points = [
      point(NOW - 5 * DAY, 50),
      point(NOW - 4 * DAY, 51),
      point(NOW - 3 * DAY, 57),
      point(NOW - 2 * DAY, 56),
      point(NOW - 1 * DAY, 62),
      point(NOW, 62),
    ];
    const moves = crowdMoves(points, []);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(moves.every((move) => move.source.startsWith("Gemini price history"))).toBe(true);
    expect(moves.some((move) => move.deltaCents >= 3 && move.title.includes("moved"))).toBe(true);
  });

  it("attaches a matched post when it happened near a move, and never invents a headline", () => {
    const points = [
      point(NOW - 2 * DAY, 50),
      point(NOW - DAY, 58),
      point(NOW, 58),
    ];
    const post: ResearchPostContext = {
      source: "x-feed",
      text: "SOL funds saw another day of inflows",
      author: "@solanafloor",
      url: "https://x.com/solanafloor/status/1",
      why: "mentions Solana",
      atMs: NOW - DAY,
    };
    const [move] = crowdMoves(points, [post]);
    expect(move?.title).toBe("@solanafloor: SOL funds saw another day of inflows");
    expect(move?.source).toMatch(/Matched X post/);
    expect(move?.deltaCents).toBe(8);
  });
});

describe("trustOdds", () => {
  it("states live volume, spread and day move without inventing a trader count", () => {
    const lines = trustOdds(baseView());
    expect(lines.map((line) => line.kind)).toEqual(["activity", "spread", "jumpiness"]);
    expect(lines[0]?.text).toBe("Good activity: $84k traded in total, $2.1k in the last 24 hours");
    expect(lines[1]?.text).toBe("Tight spread: buy and sell prices are 2¢ apart");
    expect(lines[2]?.text).toBe("Jumpy: moved 9 points in a day");
    expect(lines.some((line) => /trader/i.test(line.text))).toBe(false);
  });

  it("hides activity when Gemini omitted volume", () => {
    const lines = trustOdds(baseView({ market: { volume: null, volume24h: null } as ResearchView["market"] }));
    expect(lines.some((line) => line.kind === "activity")).toBe(false);
  });
});

describe("marketDrivers", () => {
  it("derives push and pull factors only from the parsed settlement rule", () => {
    const view = baseView();
    const drivers = marketDrivers(parseResolution(view.market.rulesText, view.market.termsLink), view, NOW);
    expect(drivers?.up).toEqual(["The settlement price finishing above $200.00"]);
    expect(drivers?.down).toEqual(["The settlement price finishing at or below $200.00"]);
  });

  it("hides the section when the rules have no measurable threshold", () => {
    const view = baseView({ market: { rulesText: "The official event rules will be used.", termsLink: null } as ResearchView["market"] });
    expect(marketDrivers(parseResolution(view.market.rulesText, null), view, NOW)).toBeNull();
  });
});

describe("brief helpers", () => {
  const brief: ResearchBrief = {
    symbol: "GEMI-SOL261231-ABOVE200",
    generatedAt: "2026-11-12T16:00:00.000Z",
    headline: "Solana price on Dec 31: Above $200 is priced at 48¢ for YES",
    sections: [{ title: "What the market thinks", body: "Buying YES costs 48¢, which the market reads as roughly a 48% chance." }],
    polishedBy: "template",
  };

  it("reads the purchased Yes price from the brief and describes later movement", () => {
    expect(yesCentsFromBrief(brief)).toBe(48);
    const stale = briefStaleCopy(Date.parse("2026-11-12T16:00:00.000Z"), 48, 62);
    expect(stale.summary).toBe("Bought Nov 12 at 48%. Odds have moved 14 points since.");
    expect(stale.needsRefresh).toBe(true);
  });
});

describe("stake caps", () => {
  const budget: TradeBudget = { perTradeMaxCents: 1000, remainingCents: 400, autoApproveMaxCents: 200 };

  it("caps a trade to the remaining daily budget and flags amounts that need approval", () => {
    expect(tradeCapCents(budget)).toBe(400);
    expect(overTradeLimitMessage(500, budget)).toBe("Over your limit: max $10 per trade ($4 left today)");
    expect(needsApprovalNote(300, { ...budget, remainingCents: 2000 })).toBe("Needs approval");
    expect(needsApprovalNote(200, budget)).toBeNull();
  });
});
