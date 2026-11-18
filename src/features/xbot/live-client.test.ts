import { describe, expect, it } from "vitest";
import { createLiveXClient } from "./live-client";

const credentials = {
  apiKey: "api-key-value",
  apiSecret: "api-secret-value",
  accessToken: "access-token-value",
  accessSecret: "access-secret-value",
  bearerToken: "bearer-token-value",
};

interface Seen {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: string;
}

function setup(respond: () => Response | Error) {
  const seen: Seen[] = [];
  const fakeFetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, init: init ?? {}, body: typeof init?.body === "string" ? init.body : "" });
    const outcome = respond();
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }) as typeof fetch;
  const client = createLiveXClient({
    credentials,
    fetch: fakeFetch,
    userId: "999",
    now: () => new Date("2026-11-17T12:00:00Z"),
    nonce: () => "fixed-nonce",
  });
  return { client, seen };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function header(seen: Seen | undefined, name: string): string {
  return new Headers(seen?.init.headers).get(name) ?? "";
}

describe("postReply", () => {
  it("posts the reply as an OAuth 1.0a signed JSON request", async () => {
    const { client, seen } = setup(() => json({ data: { id: "111", text: "hi" } }));
    const result = await client.postReply("42", "hello world");
    expect(result).toEqual({ ok: true, value: { id: "111" } });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.x.com/2/tweets");
    expect(seen[0]?.init.method).toBe("POST");
    expect(JSON.parse(seen[0]?.body ?? "")).toEqual({ text: "hello world", reply: { in_reply_to_tweet_id: "42" } });
    const authorization = header(seen[0], "authorization");
    expect(authorization.startsWith("OAuth ")).toBe(true);
    expect(authorization).toContain("oauth_signature=");
    expect(authorization).toContain('oauth_consumer_key="api-key-value"');
    expect(authorization).toContain('oauth_timestamp="1794916800"');
    expect(authorization).not.toContain("api-secret-value");
    expect(authorization).not.toContain("access-secret-value");
    expect(header(seen[0], "content-type")).toBe("application/json");
  });

  it.each([
    [401, { kind: "unauthorized" }],
    [403, { kind: "forbidden" }],
    [429, { kind: "rate-limited" }],
    [500, { kind: "http", status: 500 }],
    [400, { kind: "http", status: 400 }],
  ])("maps HTTP %i to a typed error without leaking the body", async (status, error) => {
    const { client } = setup(() => json({ detail: "secret upstream detail api-secret-value" }, status));
    const result = await client.postReply("42", "x");
    expect(result).toEqual({ ok: false, error });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("maps a thrown fetch to a network error", async () => {
    const { client } = setup(() => new Error("connect ECONNREFUSED with api-secret-value"));
    const result = await client.postReply("42", "x");
    expect(result).toEqual({ ok: false, error: { kind: "network" } });
  });

  it("maps an unexpected success body to a parse error", async () => {
    const { client } = setup(() => json({ unexpected: true }));
    expect(await client.postReply("42", "x")).toEqual({ ok: false, error: { kind: "parse" } });
  });

  it("maps a non-JSON success body to a parse error", async () => {
    const { client } = setup(() => new Response("<html>", { status: 200 }));
    expect(await client.postReply("42", "x")).toEqual({ ok: false, error: { kind: "parse" } });
  });
});

const mentionsBody = {
  data: [
    {
      id: "300",
      text: "@bot yes 2",
      author_id: "u2",
      created_at: "2026-11-17T12:00:01.000Z",
      conversation_id: "100",
      referenced_tweets: [{ type: "replied_to", id: "200" }],
    },
    { id: "250", text: "@bot hi", author_id: "u1", referenced_tweets: [{ type: "quoted", id: "9" }] },
    { id: "400", text: "@bot orphan", author_id: "missing-user" },
  ],
  includes: {
    users: [
      { id: "u1", username: "Alice" },
      { id: "u2", username: "Priscilla" },
    ],
  },
  meta: { newest_id: "400", result_count: 3 },
};

describe("fetchMentions", () => {
  it("requests the mentions timeline with a bearer token and the documented fields", async () => {
    const { client, seen } = setup(() => json(mentionsBody));
    await client.fetchMentions("150");
    const url = new URL(seen[0]?.url ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://api.x.com/2/users/999/mentions");
    expect(url.searchParams.get("since_id")).toBe("150");
    expect(url.searchParams.get("expansions")).toBe("author_id,referenced_tweets.id");
    expect(url.searchParams.get("tweet.fields")).toBe("author_id,conversation_id,referenced_tweets,created_at");
    expect(url.searchParams.get("user.fields")).toBe("username");
    expect(header(seen[0], "authorization")).toBe("Bearer bearer-token-value");
  });

  it("omits since_id when there is no cursor", async () => {
    const { client, seen } = setup(() => json({ meta: { result_count: 0 } }));
    const result = await client.fetchMentions();
    expect(new URL(seen[0]?.url ?? "").searchParams.has("since_id")).toBe(false);
    expect(result).toEqual({ ok: true, value: { posts: [] } });
  });

  it("maps mentions to posts, oldest first, with normalized handles and reply parents", async () => {
    const { client } = setup(() => json(mentionsBody));
    const result = await client.fetchMentions();
    expect(result).toEqual({
      ok: true,
      value: {
        newestId: "400",
        posts: [
          { id: "250", text: "@bot hi", authorHandle: "@alice" },
          { id: "300", text: "@bot yes 2", authorHandle: "@priscilla", inReplyToId: "200", createdAt: "2026-11-17T12:00:01.000Z" },
        ],
      },
    });
  });

  it("discards mentions whose upstream usernames are malformed before normalization", async () => {
    const { client } = setup(() => json({
      ...mentionsBody,
      includes: { users: [{ id: "u2", username: "  @@PRISCILLA " }] },
    }));
    expect(await client.fetchMentions()).toEqual({ ok: true, value: { posts: [], newestId: "400" } });
  });

  it("maps HTTP errors and malformed bodies to typed errors", async () => {
    expect(await setup(() => json({}, 429)).client.fetchMentions()).toEqual({ ok: false, error: { kind: "rate-limited" } });
    expect(await setup(() => json({ data: [{ id: "abc", text: "x" }] })).client.fetchMentions()).toEqual({
      ok: false,
      error: { kind: "parse" },
    });
  });
});
