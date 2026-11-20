import { describe, expect, it, vi } from "vitest";
import { createXFeed } from "./feed";

const NOW = new Date("2026-11-20T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

function bucket(index: number, tweet_count: number) {
  const start = new Date(NOW.getTime() - (30 - index) * HOUR_MS);
  return { start: start.toISOString(), end: new Date(start.getTime() + HOUR_MS).toISOString(), tweet_count };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function requestUrl(input: RequestInfo | URL | undefined): URL {
  if (input === undefined) throw new Error("Expected a request URL");
  if (input instanceof URL) return input;
  if (input instanceof Request) return new URL(input.url);
  return new URL(input);
}

function fakeFetch(
  counts: readonly unknown[],
  search: unknown = {},
  statuses: { readonly counts?: number; readonly search?: number } = {},
) {
  const fetch = vi.fn<typeof globalThis.fetch>((input) => {
    const url = requestUrl(input);
    return Promise.resolve(url.pathname.endsWith("/counts/recent")
      ? response({ data: counts }, statuses.counts)
      : response(search, statuses.search));
  });
  return fetch;
}

function feed(fetch: typeof globalThis.fetch, cacheMs?: number) {
  return createXFeed({
    bearerToken: "test-token",
    fetch,
    now: () => NOW,
    ...(cacheMs === undefined ? {} : { cacheMs }),
  });
}

describe("createXFeed", () => {
  it("computes the surge baseline from the previous 24 complete buckets", async () => {
    const counts = [
      ...Array.from({ length: 24 }, (_, index) => bucket(index, index + 1)),
      bucket(24, 40),
      bucket(25, 999),
    ];
    const fetch = fakeFetch(counts);
    const result = await feed(fetch).signals("bitcoin");
    expect(result).toEqual({ counts: { lastHourCount: 40, baselineHourlyCount: 12.5 }, breakingPost: null });
    const countRequest = fetch.mock.calls.find(([input]) => requestUrl(input).pathname.endsWith("/counts/recent"));
    const countUrl = requestUrl(countRequest?.[0]);
    expect(countUrl.searchParams.get("query")).toBe("(bitcoin) -is:retweet");
    expect(countUrl.searchParams.get("granularity")).toBe("hour");
  });

  it("drops the newest incomplete bucket before selecting the last complete hour", async () => {
    const result = await feed(fakeFetch([bucket(0, 8), bucket(1, 14), bucket(2, 900)])).signals("bitcoin");
    expect(result).toMatchObject({ counts: { lastHourCount: 14, baselineHourlyCount: 8 } });
  });

  it("marks counts unavailable when there are no complete count buckets", async () => {
    const fetch = fakeFetch([bucket(0, 900)]);
    expect(await feed(fetch).signals("bitcoin")).toEqual({ counts: undefined, breakingPost: null });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("selects the most engaged verified post and requests the recent English results", async () => {
    const search = {
      data: [
        { id: "low", text: "Low engagement", author_id: "u1", created_at: NOW.toISOString(), public_metrics: { retweet_count: 2, quote_count: 1, reply_count: 1 } },
        { id: "best", text: "Important update", author_id: "u2", created_at: NOW.toISOString(), public_metrics: { retweet_count: 5, quote_count: 2, reply_count: 1 } },
        { id: "tie", text: "Tie", author_id: "u3", created_at: NOW.toISOString(), public_metrics: { retweet_count: 4, quote_count: 3, reply_count: 1 } },
      ],
      includes: { users: [{ id: "u1", username: "one" }, { id: "u2", username: "two" }, { id: "u3", username: "three" }] },
    };
    const fetch = fakeFetch([bucket(0, 20), bucket(1, 21)], search);
    const result = await feed(fetch).signals("bitcoin december");
    expect(result?.breakingPost).toEqual({
      id: "best",
      text: "Important update",
      authorUsername: "two",
      url: "https://x.com/two/status/best",
    });
    const searchRequest = fetch.mock.calls.find(([input]) => requestUrl(input).pathname.endsWith("/search/recent"));
    const searchUrl = requestUrl(searchRequest?.[0]);
    expect(searchUrl.searchParams.get("query")).toBe("(bitcoin december) is:verified -is:retweet -is:reply lang:en");
    expect(searchUrl.searchParams.get("start_time")).toBe("2026-11-20T11:00:00.000Z");
    expect(searchUrl.searchParams.get("max_results")).toBe("10");
    expect(searchUrl.searchParams.get("tweet.fields")).toBe("created_at,public_metrics,author_id");
    expect(searchUrl.searchParams.get("expansions")).toBe("author_id");
    expect(searchUrl.searchParams.get("user.fields")).toBe("username");
  });

  it("requires at least five engagements for a breaking post", async () => {
    const search = {
      data: [{ id: "quiet", text: "Quiet post", author_id: "u1", created_at: NOW.toISOString(), public_metrics: { retweet_count: 2, quote_count: 1, reply_count: 1 } }],
      includes: { users: [{ id: "u1", username: "quiet" }] },
    };
    const result = await feed(fakeFetch([bucket(0, 20), bucket(1, 21)], search)).signals("bitcoin");
    expect(result?.breakingPost).toBeNull();
  });

  it("keeps counts available when the breaking search fails and caches each part", async () => {
    const fetch = fakeFetch([bucket(0, 10), bucket(1, 30), bucket(2, 999)], {}, { search: 429 });
    const xFeed = feed(fetch);
    const first = await xFeed.signals("bitcoin");
    const second = await xFeed.signals("bitcoin");

    expect(first).toEqual({ counts: { lastHourCount: 30, baselineHourlyCount: 10 }, breakingPost: undefined });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps breaking news available when counts fail and caches each part", async () => {
    const search = {
      data: [{ id: "breaking", text: "Major update", author_id: "u1", created_at: NOW.toISOString(), public_metrics: { retweet_count: 5, quote_count: 0, reply_count: 0 } }],
      includes: { users: [{ id: "u1", username: "reporter" }] },
    };
    const fetch = fakeFetch([bucket(0, 10), bucket(1, 30)], search, { counts: 429 });
    const xFeed = feed(fetch);
    const first = await xFeed.signals("bitcoin");
    const second = await xFeed.signals("bitcoin");

    expect(first).toEqual({
      counts: undefined,
      breakingPost: { id: "breaking", text: "Major update", authorUsername: "reporter", url: "https://x.com/reporter/status/breaking" },
    });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caches successful signals per query", async () => {
    const fetch = fakeFetch([bucket(0, 20), bucket(1, 21)]);
    const xFeed = feed(fetch);
    const first = await xFeed.signals("bitcoin");
    const second = await xFeed.signals("bitcoin");
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);

    await xFeed.signals("federal reserve");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer test-token");
  });

  it("expires cached results after cacheMs", async () => {
    let now = NOW;
    const fetch = fakeFetch([bucket(0, 20), bucket(1, 21)]);
    const xFeed = createXFeed({ bearerToken: "test-token", fetch, now: () => now, cacheMs: 1000 });
    await xFeed.signals("bitcoin");
    now = new Date(NOW.getTime() + 1001);
    await xFeed.signals("bitcoin");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("caches HTTP and parse failures as unavailable signals", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({}, 429));
    const xFeed = feed(fetch);
    expect(await xFeed.signals("bitcoin")).toEqual({ counts: undefined, breakingPost: undefined });
    expect(await xFeed.signals("bitcoin")).toEqual({ counts: undefined, breakingPost: undefined });
    expect(fetch).toHaveBeenCalledTimes(2);

    const malformed = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ data: [{ tweet_count: "bad" }] }));
    const malformedFeed = feed(malformed);
    expect(await malformedFeed.signals("bitcoin")).toEqual({ counts: undefined, breakingPost: undefined });
    expect(await malformedFeed.signals("bitcoin")).toEqual({ counts: undefined, breakingPost: undefined });
    expect(malformed).toHaveBeenCalledTimes(2);

    const missingAuthor = fakeFetch([bucket(0, 20), bucket(1, 21)], {
      data: [{ id: "post", text: "Post", author_id: "u1", created_at: NOW.toISOString(), public_metrics: { retweet_count: 5, quote_count: 0, reply_count: 0 } }],
    });
    const missingAuthorFeed = feed(missingAuthor);
    expect(await missingAuthorFeed.signals("bitcoin")).toEqual({
      counts: { lastHourCount: 20, baselineHourlyCount: 0 },
      breakingPost: undefined,
    });
    expect(await missingAuthorFeed.signals("bitcoin")).toEqual({
      counts: { lastHourCount: 20, baselineHourlyCount: 0 },
      breakingPost: undefined,
    });
    expect(missingAuthor).toHaveBeenCalledTimes(2);
  });
});
