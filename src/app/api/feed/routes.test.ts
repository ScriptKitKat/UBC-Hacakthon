import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Desk, DeskAccess } from "@/features/desk";
import type { DecisionLogEntry, FeedMatch } from "@/shared";
import { OPTIONS as buyOptions, POST as buy } from "./buy/route";
import { POST as confirm } from "./confirm/route";
import { OPTIONS as matchOptions, POST as match } from "./match/route";
import { MAX_PREWARM_POSTS, POST as prewarm } from "./prewarm/route";
import { GET as quote } from "./quote/route";

const getDesk = vi.hoisted(() => vi.fn<() => Promise<DeskAccess>>());

vi.mock("@/features/desk", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/desk")>()), getDesk }));

const EXTENSION = `chrome-extension://${"a".repeat(32)}`;
const entry: DecisionLogEntry = {
  entryId: "e1", kind: "approve", spokenReason: "Done.", intentId: "i1", symbol: "GEMI-FED-HOLD", outcome: "yes",
  notionalCents: 100, senderId: "operator", source: "feed", at: "2026-11-17T12:00:00.000Z",
  explorerUrl: "https://explorer.test/tx/sig",
};
const matched: FeedMatch = { kind: "no-match", postId: "p1", matchedBy: "keywords", reason: "none" };

const matchPost = vi.fn<Desk["matchPost"]>();
const deskQuote = vi.fn<Desk["quote"]>();
const buyFromFeed = vi.fn<Desk["buyFromFeed"]>();
const confirmFromFeed = vi.fn<Desk["confirmFromFeed"]>();
const stubDesk = { matchPost, quote: deskQuote, buyFromFeed, confirmFromFeed } as unknown as Desk;

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validBuy = { postId: "p1", instrumentSymbol: "GEMI-FED-HOLD", outcome: "yes", amountCents: 100 };

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("FEED_EXTENSION_ORIGINS", "");
  matchPost.mockReset().mockResolvedValue(matched);
  deskQuote.mockReset();
  buyFromFeed.mockReset().mockResolvedValue(entry);
  confirmFromFeed.mockReset().mockResolvedValue({ ok: true, entry });
  getDesk.mockResolvedValue({ ok: true, desk: stubDesk });
});

describe("feed cors", () => {
  it("answers preflight for extension origins", () => {
    const response = buyOptions(new Request("http://desk.test/api/feed/buy", { method: "OPTIONS", headers: { origin: EXTENSION } }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(EXTENSION);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("rejects preflight from web pages", () => {
    const response = matchOptions(new Request("http://desk.test/api/feed/match", { method: "OPTIONS", headers: { origin: "https://x.com" } }));
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("adds cors headers to responses for extension origins", async () => {
    const response = await match(post("http://desk.test", { postId: "p1", text: "Fed holds rates" }, { origin: EXTENSION }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(EXTENSION);
  });

  it("adds cors headers to validation errors too", async () => {
    const response = await match(post("http://desk.test", { text: "" }, { origin: EXTENSION }));
    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe(EXTENSION);
  });

  it.each(["https://x.com", "https://twitter.com", "http://localhost:3000", "chrome-extension://short", "null"])(
    "returns 403 for foreign origin %s without touching the desk",
    async (origin) => {
      const response = await buy(post("http://desk.test", validBuy, { origin }));
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(buyFromFeed).not.toHaveBeenCalled();
    },
  );

  it("rejects foreign origins on GET quote", async () => {
    const response = await quote(new Request("http://desk.test/api/feed/quote?symbol=A", { headers: { origin: "https://x.com" } }));
    expect(response.status).toBe(403);
    expect(deskQuote).not.toHaveBeenCalled();
  });

  it("accepts requests without an Origin header", async () => {
    const response = await buy(post("http://desk.test", validBuy));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("restricts to FEED_EXTENSION_ORIGINS when configured", async () => {
    vi.stubEnv("FEED_EXTENSION_ORIGINS", `${EXTENSION}, chrome-extension://${"b".repeat(32)}`);
    expect((await buy(post("http://desk.test", validBuy, { origin: EXTENSION }))).status).toBe(200);
    expect((await buy(post("http://desk.test", validBuy, { origin: `chrome-extension://${"c".repeat(32)}` }))).status).toBe(403);
  });
});

describe("feed validation", () => {
  it.each([
    ["match without text", match, { postId: "p1", text: " " }],
    ["match with long text", match, { postId: "p1", text: "x".repeat(2001) }],
    ["match with bad url", match, { postId: "p1", text: "hello", url: "nope" }],
    ["buy outcome", buy, { ...validBuy, outcome: "maybe" }],
    ["buy fractional cents", buy, { ...validBuy, amountCents: 1.5 }],
    ["buy zero", buy, { ...validBuy, amountCents: 0 }],
    ["buy huge", buy, { ...validBuy, amountCents: 10_000_000 }],
    ["confirm", confirm, { intentId: "" }],
    ["malformed json", match, "{"],
  ])("returns 400 for %s", async (_name, handler, body) => {
    const response = await handler(post("http://desk.test", body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid-request" });
  });

  it("requires application/json on posts", async () => {
    const response = await match(
      new Request("http://desk.test", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ postId: "p1", text: "hello" }) }),
    );
    expect(response.status).toBe(415);
  });

  it("requires a symbol for quotes", async () => {
    expect((await quote(new Request("http://desk.test/api/feed/quote"))).status).toBe(400);
  });
});

describe("feed behaviour", () => {
  it("returns the match for a post", async () => {
    const response = await match(post("http://desk.test", { postId: "p1", text: "Fed holds rates", author: "@Reuters" }));
    expect(await response.json()).toEqual(matched);
    expect(matchPost).toHaveBeenCalledWith({ id: "p1", text: "Fed holds rates", author: "@Reuters" });
  });

  it("returns 404 for an unknown quote symbol and the quote otherwise", async () => {
    deskQuote.mockResolvedValueOnce(undefined);
    expect((await quote(new Request("http://desk.test/api/feed/quote?symbol=NOPE"))).status).toBe(404);
    const found = { market: { instrumentSymbol: "A" }, history: [] } as unknown as Awaited<ReturnType<Desk["quote"]>>;
    deskQuote.mockResolvedValueOnce(found);
    const response = await quote(new Request("http://desk.test/api/feed/quote?symbol=A"));
    expect(await response.json()).toEqual(found);
    expect(deskQuote).toHaveBeenLastCalledWith("A");
  });

  it("buys through the feed operator and never forwards client sender data", async () => {
    const response = await buy(post("http://desk.test", { ...validBuy, senderId: "attacker", source: "desk", notionalCents: 99999 }));
    expect(await response.json()).toEqual({ entry });
    expect(buyFromFeed).toHaveBeenCalledWith({ instrumentSymbol: "GEMI-FED-HOLD", outcome: "yes", notionalCents: 100 });
  });

  it("confirms pending feed intents and reports unknown ones", async () => {
    expect(await (await confirm(post("http://desk.test", { intentId: "i1", approverId: "attacker" }))).json()).toEqual({ entry });
    expect(confirmFromFeed).toHaveBeenCalledWith("i1");
    confirmFromFeed.mockResolvedValueOnce({ ok: false, error: "unknown-intent" });
    expect((await confirm(post("http://desk.test", { intentId: "nope" }))).status).toBe(404);
  });

  it("returns 503 when the desk is misconfigured and 500 when it throws", async () => {
    getDesk.mockResolvedValueOnce({ ok: false, issues: ["DAILY_CAP_USD: required"] });
    expect((await buy(post("http://desk.test", validBuy))).status).toBe(503);
    buyFromFeed.mockRejectedValueOnce(new Error("boom"));
    expect((await buy(post("http://desk.test", validBuy, { origin: EXTENSION }))).status).toBe(500);
  });
});

describe("feed prewarm", () => {
  const posts = [
    { postId: "p1", text: "Fed holds rates", author: "@Reuters", url: "https://x.com/Reuters/status/1" },
    { postId: "p2", text: "Bitcoin slides" },
  ];

  it("matches every post through the desk's cached matcher", async () => {
    matchPost.mockImplementation((input) => Promise.resolve({ kind: "no-match", postId: input.id, matchedBy: "keywords", reason: "none" }));
    const response = await prewarm(post("http://desk.test", { posts }));
    expect(await response.json()).toEqual({ warmed: [{ postId: "p1", kind: "no-match" }, { postId: "p2", kind: "no-match" }] });
    expect(matchPost).toHaveBeenCalledTimes(2);
    expect(matchPost).toHaveBeenNthCalledWith(1, { id: "p1", text: "Fed holds rates", author: "@Reuters" });
    expect(matchPost).toHaveBeenNthCalledWith(2, { id: "p2", text: "Bitcoin slides" });
  });

  it("accepts server calls without an Origin header and extension origins, and rejects web pages", async () => {
    expect((await prewarm(post("http://desk.test", { posts }))).status).toBe(200);
    const fromExtension = await prewarm(post("http://desk.test", { posts }, { origin: EXTENSION }));
    expect(fromExtension.headers.get("access-control-allow-origin")).toBe(EXTENSION);
    expect((await prewarm(post("http://desk.test", { posts }, { origin: "https://x.com" }))).status).toBe(403);
  });

  it.each([
    ["no posts", { posts: [] }],
    ["too many posts", { posts: Array.from({ length: MAX_PREWARM_POSTS + 1 }, (_, index) => ({ postId: `p${String(index)}`, text: "hello" })) }],
    ["a bad post", { posts: [{ postId: "", text: "hello" }] }],
  ])("returns 400 for %s", async (_name, body) => {
    expect((await prewarm(post("http://desk.test", body))).status).toBe(400);
    expect(matchPost).not.toHaveBeenCalled();
  });

  it("requires the bearer token only when FEED_PREWARM_TOKEN is set", async () => {
    vi.stubEnv("FEED_PREWARM_TOKEN", "s3cret");
    expect((await prewarm(post("http://desk.test", { posts }))).status).toBe(401);
    expect((await prewarm(post("http://desk.test", { posts }, { authorization: "Bearer nope" }))).status).toBe(401);
    expect(matchPost).not.toHaveBeenCalled();
    expect((await prewarm(post("http://desk.test", { posts }, { authorization: "Bearer s3cret" }))).status).toBe(200);
    expect(matchPost).toHaveBeenCalledTimes(2);
  });

  it("leaves match open without the token", async () => {
    vi.stubEnv("FEED_PREWARM_TOKEN", "s3cret");
    expect((await match(post("http://desk.test", { postId: "p1", text: "Fed holds rates" }))).status).toBe(200);
  });
});
