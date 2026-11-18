import { beforeAll, describe, expect, it } from "vitest";
import { createGeminiMarketsClient } from "@/features/markets";
import type { MarketEvent } from "@/features/markets";
import snapshot from "./fixtures/active-snapshot.json";
import { MAX_WHY_LENGTH, MIN_POST_SCORE, isIntradayEvent, matchPostToEvents, sportsSearchTerms } from "./index";

const NOW = new Date("2026-11-17T12:00:00Z");
let events: readonly MarketEvent[] = [];

beforeAll(async () => {
  const client = createGeminiMarketsClient({
    baseUrl: "https://example.test",
    fetch: () => Promise.resolve(Response.json(snapshot)),
  });
  const page = await client.searchEvents({ limit: 100 });
  if (!page.ok) throw new Error("snapshot failed to parse");
  events = page.value.events;
});

function pick(text: string, at: Date = NOW) {
  return matchPostToEvents(text, events, at);
}

type Row = readonly [name: string, text: string, ticker: string, label?: string];

const REAL_POSTS: readonly Row[] = [
  ["Jeremybtc/2122621916934500390", "POLYMARKET PUTS DECEMBER FED RATE HIKE ODDS AT 92% ... 25 basis point increase at the December 9 decision. Rate cut odds are below 1%", "FED261211", "Hike 25bps"],
  ["MookieNFT/2122020609932587169", "Markets are pricing in a 100% chance of a Fed rate hike in December ... Fed Chair Warsh speaks ... FOMC Minutes", "FED261211", "Hike 25bps"],
  ["financespotnews/2122386214456041813", "October core PPI came in stronger than expected... Market odds of a December Fed rate cut have fallen after hawkish comments", "FED261211"],
  ["coin_gabbar_/2122569858189861012", "Bitcoin Price Prediction: BTC Stays Below $65K as Whales Sell $3.40B ... Will BTC recover above $65K?", "BTC2611182200", "$65,000 or above"],
  ["lookonchain/2122896058963661224", "Bitcoin miner MARA Holdings continues to dump $BTC ...", "BTC2611182200"],
  ["FINANCIERNEWS/2122888949626548657", "Bitcoin Price Could Gain If AI Slump Prompts Fed Pivot, Coinshares Says", "BTC2611182200"],
  ["BSCNWire/2122080514043482586", "The US CLARITY Act crypto market structure bill has stalled in the Senate...", "CRYPTOSTRUCT26"],
  ["InvestInNews/2120579898280681568", "BREAKING: US Senate votes 49-50 against advancing the CLARITY Act ... crypto market structure bill falls one vote short", "CRYPTOSTRUCT26"],
  ["joinantic/2122556892543394292", "8-1 49ers vs 7-2 Vikings on Sunday Night Football. SF by 3.", "NFL-2611230120-MIN-SF-M"],
  ["Footballblazer_/2122785596015833325", "Brian Flores on the Vikings playing at altitude in Mexico City ... 7 and 2 Vikings vs 8 and 1 49ers, Sunday night", "NFL-2611230120-MIN-SF-M", "Minnesota"],
  ["avasterlinx2lt/2121332661851709507", "Anthropic's Claude Fable 5.2 just took the top spot in the Artificial Analysis Intelligence Index ... ahead of Gemini 4 Carbon, Claude Opus 5.5, GPT-6 Astra", "BESTAI26", "Claude"],
  ["GlenBytes/2120832095002255657", "AI leaderboard update. Claude Fable 5.2 takes the crown ... Gemini 4 Carbon ... GPT-6 Astra", "BESTAI26", "Claude"],
];

const SYNTHETIC_POSTS: readonly Row[] = [
  ["Powell cut", "Powell signals the Fed will cut rates by 25 basis points in December", "FED261211", "Cut 25bps"],
  ["Fed holds", "Fed holds rates steady as inflation cools", "FED261211", "Fed maintains rate"],
  ["jobs report", "Jobs report: nonfarm payrolls beat forecasts as jobless claims fall", "UNEMP2026"],
  ["recession", "US economy shrinks 0.5% in third quarter as recession fears grow", "RECESSION26"],
  ["GDP", "GDP grew 2.3% last quarter, Commerce Department says", "GDP2026", "2.1 to 2.5"],
  ["S&P record", "Wall Street rallies as the S&P 500 hits a record high", "SPXHIGH26"],
  ["S&P selloff", "Stocks plunge in a broad sell-off, S&P 500 falls 3%", "SPXLOW26"],
  ["Nasdaq", "Nasdaq slides as tech stocks reprice AI spending", "NASDAQ2026"],
  ["Hormuz", "Tanker traffic through the Strait of Hormuz resumes after Iran talks", "HORMUZNORMAL"],
  ["WTI", "OPEC output cut sends crude oil above $85 a barrel", "WTI2611182200", "$85 or above"],
  ["Brent", "Brent crude hits $90 on supply fears", "BRENT2611182200", "$90 or above"],
  ["gold", "Gold climbs to $3,800 as investors seek a safe haven", "XAU2611182200", "$3,800 or above"],
  ["ether", "Ethereum tops $1,800 as ether rallies", "ETH2611182200", "$1,800 or above"],
  ["Newsom", "Newsom says he will decide on a 2028 Democratic primary run after the midterms", "DEMNOM2028", "Gavin Newsom"],
  ["Vance", "Vance eyes 2028 run, allies say", "PRES2028", "JD Vance"],
  ["Hegseth", "Pete Hegseth resigns from the cabinet, sources say", "CABINET-26", "Pete Hegseth"],
  ["Greenland", "Trump renews push to buy Greenland from Denmark", "BUYGREEN"],
  ["Alito", "Justice Alito weighs retirement from the Supreme Court", "ALITORETIRE"],
  ["Artemis", "NASA Artemis crew ready for the moon landing mission", "NASAMOON"],
  ["Dune", "Dune: Part Three reviews are in, Rotten Tomatoes score lands at 87%", "DUNEPART3RT", "Above 87"],
  ["GTA", "GTA VI is the favorite to win Game of the Year at The Game Awards", "GOTY2026", "Grand Theft Auto VI"],
  ["Knicks", "Knicks beat the Timberwolves in a thriller at the Garden", "NBA-2611200100-NYK-MIN-M"],
  ["Lakers", "Lakers and Jazz tip off tonight", "NBA-2611190300-UTA-LAL-M"],
  ["Chelsea", "Chelsea vs Nottingham Forest preview", "EPL-2611272000-CHE-NFO-M"],
];

describe("headline to market table", () => {
  it.each([...REAL_POSTS, ...SYNTHETIC_POSTS].map(([name, text, ticker, label]) => ({ name, text, ticker, label })))("$name", ({ text, ticker, label }) => {
    const result = pick(text);
    expect(result?.event.ticker).toBe(ticker);
    if (label !== undefined) expect(result?.contract.label).toBe(label);
    expect(result?.score).toBeGreaterThanOrEqual(MIN_POST_SCORE);
    expect(result?.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result?.contract.prices.buyYesCents).not.toBeNull();
    expect(result?.why.length).toBeLessThanOrEqual(MAX_WHY_LENGTH);
  });

  it("picks the hike contract's symbol for hike posts", () => {
    expect(pick(REAL_POSTS[0]?.[1] ?? "")?.contract.instrumentSymbol).toBe("GEMI-FED261211-HIKE25");
  });

  it.each([
    ["chatter", "good morning, coffee time ☕"],
    ["food", "Just had the best sandwich of my entire life today"],
    ["unrelated politics", "Trump signs an executive order on tariffs"],
    ["city only", "Minnesota weather: snow expected this weekend"],
    ["product name only", "Claude Code is down again for me"],
    ["generic inflation", "Inflation is so annoying at the grocery store"],
    ["empty-ish", "lol"],
  ])("gives no card for %s", (_name, text) => {
    expect(pick(text)).toBeUndefined();
  });
});

describe("why lines", () => {
  it("reads specifically for jobs and Fed posts", () => {
    expect(pick("Jobs report: payrolls beat as jobless claims fall")?.why).toBe("Jobs data feeds directly into the 2026 unemployment market.");
    expect(pick("Powell says the Fed will hold rates steady")?.why).toBe("Fed commentary from Powell moves the December rate decision odds.");
  });

  it("names both teams for a game", () => {
    expect(pick("49ers vs Vikings on Sunday night")?.why).toBe("49ers and Vikings news moves the live Minnesota vs San Francisco moneyline.");
  });
});

describe("event selection", () => {
  it("never picks intraday events", () => {
    expect(events.some(isIntradayEvent)).toBe(false);
  });

  it("rolls dated price events forward once the nearest one expires", () => {
    const later = new Date("2026-11-19T00:00:00Z");
    expect(pick("Bitcoin price slides again", later)?.event.ticker).toBe("BTC2611202200");
  });

  it("only searches sports for cities of teams the post names", () => {
    expect(sportsSearchTerms("Vikings and 49ers on Sunday")).toEqual(["Minnesota", "San Francisco"]);
    expect(sportsSearchTerms("Lakers beat the Clippers")).toEqual(["Los Angeles"]);
    expect(sportsSearchTerms("good morning")).toEqual([]);
  });
});
