import { describe, expect, it } from "vitest";
import eventFixture from "./fixtures/event-FED261211.json";
import activeFixture from "./fixtures/events-active.json";
import emptyFixture from "./fixtures/events-empty.json";
import fedFixture from "./fixtures/events-fed.json";
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

describe("searchEvents", () => {
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
    });
  });

  it("parses order limits and maps absent ones to null", async () => {
    const { client } = setup(() => jsonResponse(activeFixture));
    const result = await client.searchEvents();
    if (!result.ok) {
      throw new Error("expected ok");
    }
    const contracts = result.value.events.flatMap((event) => event.contracts);
    expect(contracts[0]?.limits).toEqual({
      quantityIncrement: "0.01",
      quantityMinimum: "0.01",
      priceIncrement: "0.01",
      priceMinimum: "0.01",
    });
    expect(contracts.every((contract) => contract.limits === null || contract.limits.priceMinimum.length > 0)).toBe(true);
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
    const { client } = setup(() => jsonResponse({}, 429));
    expect(await client.getEvent("X")).toEqual({ ok: false, error: { kind: "http", status: 429 } });
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
  it("spaces distinct requests at least one second apart", async () => {
    const { client, clock } = setup(() => jsonResponse(fedFixture));
    const startMs = clock.nowMs();
    await Promise.all([client.searchEvents({ search: "a" }), client.searchEvents({ search: "b" }), client.searchEvents({ search: "c" })]);
    expect(clock.nowMs() - startMs).toBe(2000);
  });

  it("serves repeated requests from cache within the ttl and refetches after it", async () => {
    const { client, clock, urls } = setup(() => jsonResponse(fedFixture));
    await client.searchEvents({ search: "FED" });
    await client.searchEvents({ search: "FED" });
    expect(urls).toHaveLength(1);
    clock.advance(6000);
    await client.searchEvents({ search: "FED" });
    expect(urls).toHaveLength(2);
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
