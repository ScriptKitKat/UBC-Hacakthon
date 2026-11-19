import { describe, expect, it } from "vitest";
import eventFixture from "./fixtures/event-FED261211.json";
import activeFixture from "./fixtures/events-active.json";
import emptyFixture from "./fixtures/events-empty.json";
import fedFixture from "./fixtures/events-fed.json";
import bookFixture from "./fixtures/book.json";
import candlesFixture from "./fixtures/candles-1day.json";
import tradesFixture from "./fixtures/trades.json";
import { createGeminiMarketsClient } from "./client";
import type { Clock } from "./clock";
import { formatCents } from "./format";

function createFakeClock(): Clock & { advance: (ms: number) => void } {
  let now = 1_000_000;
  return {
    nowMs: () => now,
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
    advance: (ms) => {
      now += ms;
    },
  };
}

function createFakeFetch(respond: (url: string) => Response) {
  const urls: string[] = [];
  const fakeFetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return Promise.resolve(respond(url));
  }) as typeof fetch;
  return { fakeFetch, urls };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(respond: (url: string) => Response) {
  const clock = createFakeClock();
  const { fakeFetch, urls } = createFakeFetch(respond);
  const client = createGeminiMarketsClient({ baseUrl: "https://example.test/", fetch: fakeFetch, clock });
  return { client, clock, urls };
}

function setupKnown(respond: (url: string) => Response) {
  const dataUrls: string[] = [];
  const { client, clock } = setup((url) => {
    if (url.includes("/prediction-markets/events/")) return jsonResponse(eventFixture);
    dataUrls.push(url);
    return respond(url);
  });
  return { client, clock, urls: dataUrls };
}

describe("searchEvents", () => {
  it("passes the pagination offset", async () => {
    const { client, urls } = setup(() => jsonResponse(fedFixture));
    await client.searchEvents({ limit: 10, offset: 20 });
    expect(urls).toEqual(["https://example.test/v1/prediction-markets/events?status=active&limit=10&offset=20"]);
  });

  it("builds the query url and parses events into domain types", async () => {
    const { client, urls } = setup(() => jsonResponse(fedFixture));
    const result = await client.searchEvents({ search: "FED", category: "Economics", limit: 5 });
    expect(urls).toEqual([
      "https://example.test/v1/prediction-markets/events?status=active&limit=5&search=FED&category=Economics",
    ]);
    if (!result.ok) {
      throw new Error("expected ok");
    }
    expect(result.value.total).toBe(3);
    const fed = result.value.events[0];
    expect(fed?.ticker).toBe("FED261211");
    expect(fed?.category).toBe("Economics");
    expect(fed?.expiryDate).toBe("2026-12-11T05:00:00.000Z");
    const hike = fed?.contracts[0];
    expect(hike?.instrumentSymbol).toBe("GEMI-FED261211-HIKE25");
    expect(hike?.marketState).toBe("open");
    expect(hike?.prices).toEqual({
      bestBidCents: 88,
      bestAskCents: 93,
      lastTradeCents: 93,
      buyYesCents: 93,
      buyNoCents: 12,
      sellYesCents: 88,
      sellNoCents: 7,
    });
  });

  it("parses order limits into integer units", async () => {
    const { client } = setup(() => jsonResponse(activeFixture));
    const result = await client.searchEvents();
    if (!result.ok) {
      throw new Error("expected ok");
    }
    const contracts = result.value.events.flatMap((event) => event.contracts);
    expect(contracts[0]?.limits).toEqual({
      quantityIncrementHundredths: 1n,
      quantityMinimumHundredths: 1n,
      priceIncrementCents: 1n,
      priceMinimumCents: 1n,
    });
  });

  it("maps an absent set of limits to null", async () => {
    const { client } = setup(() => jsonResponse({
      ...eventFixture,
      contracts: [{ instrumentSymbol: "SYMBOL", marketState: "open", status: "active" }],
    }));
    expect(await client.getEvent("FED261211")).toMatchObject({
      ok: true, value: { contracts: [{ limits: null }] },
    });
  });

  it("maps missing price fields to null", async () => {
    const { client } = setup(() => jsonResponse(activeFixture));
    const result = await client.searchEvents();
    if (!result.ok) {
      throw new Error("expected ok");
    }
    const sparse = result.value.events[1]?.contracts[1];
    expect(sparse?.prices).toEqual({
      bestBidCents: null,
      bestAskCents: 53,
      lastTradeCents: null,
      buyYesCents: 53,
      buyNoCents: null,
      sellYesCents: null,
      sellNoCents: 47,
    });
  });

  it("returns an empty page for no matches", async () => {
    const { client } = setup(() => jsonResponse(emptyFixture));
    const result = await client.searchEvents({ search: "bitcoin" });
    expect(result).toEqual({ ok: true, value: { events: [], total: 0 } });
  });
});

describe("getEvent", () => {
  it("fetches and parses a single event", async () => {
    const { client, urls } = setup(() => jsonResponse(eventFixture));
    const result = await client.getEvent("FED261211");
    expect(urls).toEqual(["https://example.test/v1/prediction-markets/events/FED261211"]);
    expect(result.ok && result.value.contracts.length).toBe(5);
  });
});

describe("errors", () => {
  it("returns an http error without throwing", async () => {
    const { client } = setup(() => jsonResponse({}, 404));
    expect(await client.getEvent("X")).toEqual({ ok: false, error: { kind: "http", status: 404 } });
  });

  it("retries 429 responses and serves stale cache when retries are exhausted", async () => {
    const clock = createFakeClock();
    let calls = 0;
    const { fakeFetch } = createFakeFetch(() => {
      calls += 1;
      if (calls === 1) return jsonResponse(eventFixture);
      return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    });
    const client = createGeminiMarketsClient({ baseUrl: "https://example.test", fetch: fakeFetch, clock });
    expect((await client.getEvent("FED261211")).ok).toBe(true);
    clock.advance(30_000);
    const stale = await client.getEvent("FED261211");
    expect(stale.ok).toBe(true);
    expect(calls).toBeGreaterThan(2);
  });

  it("returns a network error when fetch rejects", async () => {
    const clock = createFakeClock();
    const client = createGeminiMarketsClient({
      baseUrl: "https://example.test",
      fetch: (() => Promise.reject(new Error("https://example.test/?key=FETCH_SECRET_SENTINEL"))),
      clock,
    });
    expect(await client.getEvent("X")).toEqual({ ok: false, error: { kind: "network" } });
  });

  it.each([
    { quantityIncrement: "0" },
    { quantityIncrement: "-0.01" },
    { priceIncrement: "0.00" },
    { priceIncrement: "-0.01" },
    { quantityIncrement: "0.0000001" },
    { quantityMinimum: "0.001" },
    { priceIncrement: "0.001" },
    { priceMinimum: "-0.01" },
    { quantityMinimum: null },
    { priceIncrement: undefined },
    { prices: { buy: { yes: "0.145" } } },
  ])("rejects unsupported market data %j", async (override) => {
    const contract = { ...eventFixture.contracts[0], ...override };
    const { client } = setup(() => jsonResponse({ ...eventFixture, contracts: [contract] }));
    expect(await client.getEvent("FED261211")).toEqual({ ok: false, error: { kind: "parse" } });
  });

  it("parses exactly representable decimals with trailing zeroes", async () => {
    const contract = {
      ...eventFixture.contracts[0], quantityIncrement: "0.03000", priceIncrement: "0.01000",
      prices: { buy: { yes: "0.29000", no: "0.7" } },
    };
    const { client } = setup(() => jsonResponse({ ...eventFixture, contracts: [contract] }));
    expect(await client.getEvent("FED261211")).toMatchObject({
      ok: true, value: { contracts: [{
        prices: { buyYesCents: 29, buyNoCents: 70 },
        limits: { quantityIncrementHundredths: 3n, priceIncrementCents: 1n },
      }] },
    });
  });

  it("returns a parse error when instrumentSymbol is missing", async () => {
    const broken = structuredClone(eventFixture) as { contracts: Record<string, unknown>[] };
    delete broken.contracts[0]?.["instrumentSymbol"];
    const { client } = setup(() => jsonResponse(broken));
    const result = await client.getEvent("FED261211");
    expect(!result.ok && result.error.kind).toBe("parse");
  });

  it("returns a parse error when ticker is missing", async () => {
    const { client } = setup(() => jsonResponse({ data: [{ title: "x", status: "active" }], pagination: { total: 1 } }));
    const result = await client.searchEvents();
    expect(!result.ok && result.error.kind).toBe("parse");
  });
});

describe("rate limiting and caching", () => {
  it("caps concurrent upstream fetches", async () => {
    const clock = createFakeClock();
    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];
    const fakeFetch = (() => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<Response>((resolve) => {
        releases.push(() => {
          inFlight -= 1;
          resolve(jsonResponse(fedFixture));
        });
      });
    }) as typeof fetch;
    const client = createGeminiMarketsClient({ baseUrl: "https://example.test", fetch: fakeFetch, clock, maxInFlight: 4 });
    const done = Promise.all(Array.from({ length: 8 }, (_, index) => client.searchEvents({ search: String(index) })));
    await Promise.resolve();
    await Promise.resolve();
    expect(maxInFlight).toBe(4);
    expect(releases).toHaveLength(4);
    while (releases.length > 0) {
      const release = releases.shift();
      release?.();
      await Promise.resolve();
      await Promise.resolve();
    }
    await done;
    expect(maxInFlight).toBe(4);
  });

  it("serves repeated requests from cache within the ttl and refetches after it", async () => {
    const { client, clock, urls } = setup(() => jsonResponse(fedFixture));
    await client.searchEvents({ search: "FED" });
    await client.searchEvents({ search: "FED" });
    expect(urls).toHaveLength(1);
    clock.advance(21_000);
    await client.searchEvents({ search: "FED" });
    expect(urls).toHaveLength(2);
  });

  it("shares one request between concurrent calls for the same url", async () => {
    const { client, urls } = setup(() => jsonResponse(eventFixture));
    const results = await Promise.all([client.getEvent("FED261211", { refresh: true }), client.getEvent("FED261211"), client.getEvent("FED261211")]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(urls).toHaveLength(1);
  });

  it("checks the contract once for concurrent candles, book and trades", async () => {
    const { client, clock } = setup((url) => {
      if (url.includes("/prediction-markets/events/")) return jsonResponse(eventFixture);
      if (url.includes("/v2/candles/")) return jsonResponse(candlesFixture);
      if (url.includes("/v1/book/")) return jsonResponse(bookFixture);
      return jsonResponse(tradesFixture);
    });
    const symbol = "GEMI-FED261211-HIKE25";
    const results = await Promise.all([client.candles(symbol, "15m"), client.candles(symbol, "1hr"), client.orderBook(symbol), client.recentTrades(symbol)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(clock.nowMs()).toBeGreaterThan(0);
  });

  it("refreshes event detail within the cache ttl", async () => {
    const closed = { ...eventFixture, status: "closed" };
    let current = eventFixture;
    const { client, urls } = setup(() => jsonResponse(current));
    await client.getEvent("FED261211");
    current = closed;
    expect(await client.getEvent("FED261211", { refresh: true })).toMatchObject({ ok: true, value: { status: "closed" } });
    expect(urls).toHaveLength(2);
  });

  it("does not cache failures", async () => {
    let calls = 0;
    const { client, clock } = setup(() => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 500) : jsonResponse(eventFixture);
    });
    expect((await client.getEvent("FED261211")).ok).toBe(false);
    clock.advance(1000);
    expect((await client.getEvent("FED261211")).ok).toBe(true);
  });
});

describe("formatCents", () => {
  it("renders cents with a cent sign", () => {
    expect(formatCents(62)).toBe("62¢");
    expect(formatCents(0)).toBe("0¢");
  });
});

describe("event detail fields", () => {
  it("parses volume, description, subcategory and plain rule text", async () => {
    const richContract = {
      ...eventFixture.contracts[0],
      description: {
        nodeType: "document",
        content: [{ nodeType: "text", value: "Resolves Yes if the Fed holds. View the full [rules](https://example.test/r\\&x=1)", content: [] }],
      },
    };
    const raw = { ...eventFixture, volume: "13303.52", volume24h: "0", subcategory: { id: 2, name: "Economics", path: ["Economics"] }, contracts: [richContract] };
    const { client } = setup(() => jsonResponse(raw));
    const result = await client.getEvent("FED261211");
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toMatchObject({ volume: 13303.52, volume24h: 0, subcategory: "Economics", description: "Fed decision in December?", imageUrl: eventFixture.imageUrl, termsLink: eventFixture.termsLink });
    expect(result.value.contracts[0]?.description).toBe("Resolves Yes if the Fed holds. View the full rules");
    expect(result.value.contracts[0]?.expiryDate).toBe("2026-12-11T05:00:00.000Z");
  });

  it("reads the winning side of a settled contract and ignores unknown resolutions", async () => {
    const settled = [
      { ...eventFixture.contracts[0], status: "settled", marketState: "closed", resolutionSide: "yes" },
      { ...eventFixture.contracts[1], status: "settled", marketState: "closed", resolutionSide: "void" },
      eventFixture.contracts[2],
    ];
    const { client } = setup(() => jsonResponse({ ...eventFixture, status: "settled", contracts: settled }));
    const result = await client.getEvent("FED261211");
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.contracts[0]?.resolutionSide).toBe("yes");
    expect(result.value.contracts[1]).not.toHaveProperty("resolutionSide");
    expect(result.value.contracts[2]).not.toHaveProperty("resolutionSide");
  });

  it("treats missing volume and description as empty", async () => {
    const { client } = setup(() => jsonResponse({ ticker: "T", title: "t", status: "active" }));
    const result = await client.getEvent("T");
    expect(result).toMatchObject({ ok: true, value: { volume: null, volume24h: null, description: "", subcategory: null } });
  });
});

describe("candles", () => {
  it("requests the v2 candles endpoint and converts dollars to cents", async () => {
    const { client, urls } = setupKnown(() => jsonResponse(candlesFixture));
    const result = await client.candles("GEMI-FED261211-MAINTAIN", "1day");
    expect(urls).toEqual(["https://example.test/v2/candles/GEMI-FED261211-MAINTAIN/1day"]);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toHaveLength(6);
    expect(result.value[0]).toEqual({ timeMs: 1794960000000, openCents: 8, highCents: 8, lowCents: 5, closeCents: 6, volume: 834.93 });
    expect(result.value.every((candle) => Number.isInteger(candle.closeCents))).toBe(true);
  });

  it("returns an empty list for a market with no candles", async () => {
    const { client } = setupKnown(() => jsonResponse([]));
    expect(await client.candles("GEMI-FED261211-MAINTAIN", "1hr")).toEqual({ ok: true, value: [] });
  });

  it("rejects malformed rows", async () => {
    const { client } = setupKnown(() => jsonResponse([[1, "x", 1, 1, 1, 1]]));
    const result = await client.candles("GEMI-FED261211-MAINTAIN", "1hr");
    expect(!result.ok && result.error.kind).toBe("parse");
  });

  it("rejects prices outside 0-1 dollars", async () => {
    const { client } = setupKnown(() => jsonResponse([[1, 0.5, 1.5, 0.5, 0.5, 1]]));
    const result = await client.candles("GEMI-FED261211-MAINTAIN", "1hr");
    expect(!result.ok && result.error.kind).toBe("parse");
  });

  it("reports http failures such as exchange maintenance", async () => {
    const { client } = setup(() => jsonResponse({ error: "down" }, 500));
    expect(await client.candles("GEMI-FED261211-MAINTAIN", "1day")).toEqual({ ok: false, error: { kind: "http", status: 500 } });
  });

  it("caches repeated requests for the same timeframe", async () => {
    const { client, urls } = setupKnown(() => jsonResponse(candlesFixture));
    await client.candles("GEMI-FED261211-MAINTAIN", "1day");
    await client.candles("GEMI-FED261211-MAINTAIN", "1day");
    await client.candles("GEMI-FED261211-MAINTAIN", "1hr");
    expect(urls).toHaveLength(2);
  });

  it("refuses malformed symbols without any request", async () => {
    const { client, urls } = setup(() => jsonResponse([]));
    expect(await client.candles("GEMI-A/../B", "1day")).toEqual({ ok: false, error: { kind: "http", status: 404 } });
    expect(urls).toEqual([]);
  });

  it("refuses a symbol the event does not list before fetching candles, book or trades", async () => {
    const { client, urls } = setupKnown(() => jsonResponse([]));
    const missing = "GEMI-FED261211-NOSUCH";
    for (const result of [await client.candles(missing, "1day"), await client.orderBook(missing), await client.recentTrades(missing)]) {
      expect(result).toEqual({ ok: false, error: { kind: "http", status: 404 } });
    }
    expect(urls).toEqual([]);
  });

  it("does not look up candles for an unknown event", async () => {
    const { client, urls } = setup((url) => jsonResponse({}, url.includes("/events/") ? 404 : 200));
    expect(await client.candles("GEMI-NOPE-X", "1day")).toEqual({ ok: false, error: { kind: "http", status: 404 } });
    expect(urls).toEqual(["https://example.test/v1/prediction-markets/events/NOPE"]);
  });
});

describe("orderBook", () => {
  it("parses both sides in cents", async () => {
    const { client, urls } = setupKnown(() => jsonResponse(bookFixture));
    const result = await client.orderBook("GEMI-FED261211-MAINTAIN");
    expect(urls).toEqual(["https://example.test/v1/book/GEMI-FED261211-MAINTAIN"]);
    expect(result).toEqual({
      ok: true,
      value: {
        bids: [{ priceCents: 4, amount: 300 }, { priceCents: 3, amount: 120.5 }],
        asks: [{ priceCents: 5, amount: 421 }, { priceCents: 7, amount: 60 }],
      },
    });
  });

  it("accepts a one-sided or empty book", async () => {
    const { client } = setupKnown(() => jsonResponse({ bids: [], asks: [{ price: "0.05", amount: "421.0", timestamp: "1" }] }));
    expect(await client.orderBook("GEMI-FED261211-MAINTAIN")).toEqual({ ok: true, value: { bids: [], asks: [{ priceCents: 5, amount: 421 }] } });
  });

  it("returns a parse error for non-numeric amounts", async () => {
    const { client } = setupKnown(() => jsonResponse({ bids: [{ price: "0.5", amount: "lots" }], asks: [] }));
    const result = await client.orderBook("GEMI-FED261211-MAINTAIN");
    expect(!result.ok && result.error.kind).toBe("parse");
  });
});

describe("recentTrades", () => {
  it("requests a trade limit and parses trades newest first", async () => {
    const { client, urls } = setupKnown(() => jsonResponse(tradesFixture));
    const result = await client.recentTrades("GEMI-FED261211-MAINTAIN", 5);
    expect(urls).toEqual(["https://example.test/v1/trades/GEMI-FED261211-MAINTAIN?limit_trades=5"]);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toHaveLength(5);
    expect(result.value[0]).toEqual({ tradeId: 1893456013571898, timeMs: 1794996008205, priceCents: 6, amount: 156.33, side: "buy" });
    expect(result.value[1]?.side).toBe("sell");
  });

  it("defaults the trade limit", async () => {
    const { client, urls } = setupKnown(() => jsonResponse([]));
    await client.recentTrades("GEMI-FED261211-MAINTAIN");
    expect(urls[0]).toContain("limit_trades=30");
  });

  it("returns a network error when the exchange is unreachable", async () => {
    const clock = createFakeClock();
    const client = createGeminiMarketsClient({ baseUrl: "https://example.test", fetch: () => Promise.reject(new Error("down")), clock });
    expect(await client.recentTrades("GEMI-FED261211-MAINTAIN")).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("rejects blank or non-decimal prices and amounts", async () => {
    for (const row of [{ price: "", amount: "1" }, { price: "0.5", amount: " " }, { price: "1e-1", amount: "1" }, { price: "0.5", amount: "0x10" }]) {
      const trades = setupKnown(() => jsonResponse([{ tid: 1, timestampms: 1, type: "buy", ...row }]));
      expect((await trades.client.recentTrades("GEMI-FED261211-MAINTAIN")).ok).toBe(false);
      const book = setupKnown(() => jsonResponse({ bids: [row], asks: [] }));
      expect((await book.client.orderBook("GEMI-FED261211-MAINTAIN")).ok).toBe(false);
    }
  });

  it("rejects timestamps outside the supported date range", async () => {
    const trades = setupKnown(() => jsonResponse([{ tid: 1, timestampms: 9e15, price: "0.5", amount: "1", type: "buy" }]));
    expect((await trades.client.recentTrades("GEMI-FED261211-MAINTAIN")).ok).toBe(false);
    const candles = setupKnown(() => jsonResponse([[9e15, 0.5, 0.5, 0.5, 0.5, 1]]));
    expect((await candles.client.candles("GEMI-FED261211-MAINTAIN", "1hr")).ok).toBe(false);
  });

  it("rejects an unknown trade side", async () => {
    const { client } = setupKnown(() => jsonResponse([{ tid: 1, timestampms: 1, price: "0.5", amount: "1", type: "auction" }]));
    const result = await client.recentTrades("GEMI-FED261211-MAINTAIN");
    expect(!result.ok && result.error.kind).toBe("parse");
  });
});

describe("request interval", () => {
  it("honours a custom minimum interval", async () => {
    const clock = createFakeClock();
    const { fakeFetch } = createFakeFetch(() => jsonResponse(fedFixture));
    const client = createGeminiMarketsClient({ baseUrl: "https://example.test", fetch: fakeFetch, clock, minRequestIntervalMs: 250 });
    const startMs = clock.nowMs();
    await Promise.all([client.searchEvents({ search: "a" }), client.searchEvents({ search: "b" })]);
    expect(clock.nowMs() - startMs).toBe(250);
  });
});

describe("overload protection", () => {
  it("rejects promptly when too many requests are already queued", async () => {
    const clock = createFakeClock();
    const client = createGeminiMarketsClient({
      baseUrl: "https://example.test",
      fetch: () => new Promise(() => undefined),
      clock,
      maxInFlight: 4,
    });
    const calls = Array.from({ length: 29 }, (_, index) => client.searchEvents({ search: String(index) }));
    await Promise.resolve();
    await Promise.resolve();
    expect(await calls[28]).toEqual({ ok: false, error: { kind: "busy" } });
  });

  it("bounds the response cache", async () => {
    const { client, urls } = setup(() => jsonResponse(fedFixture));
    for (let index = 0; index < 250; index += 1) await client.searchEvents({ search: String(index) });
    await client.searchEvents({ search: "0" });
    expect(urls).toHaveLength(251);
  });
});
