import { describe, expect, it, vi } from "vitest";
import type { DecisionLogEntry, FeedMatch, FeedQuote } from "@/shared";
import { callDesk } from "./desk-api";
import { backgroundRequestSchema } from "./protocol";
import { entry, matched, quote } from "./fixtures";
import { decisionEntrySchema, feedMatchSchema, feedQuoteSchema } from "./wire";

function fakeFetch(respond: () => Promise<Response> | Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(respond()));
}

function sentBody(send: ReturnType<typeof fakeFetch>): string {
  const body = send.mock.calls[0]?.[1]?.body;
  return typeof body === "string" ? body : "";
}

describe("callDesk", () => {
  it("posts a match request and parses the card", async () => {
    const send = fakeFetch(() => Response.json(matched));
    const reply = await callDesk("http://localhost:3000/", { type: "match", postId: "1", text: "Fed holds rates steady", author: "@reuters" }, send);
    expect(reply).toEqual({ ok: true, value: matched });
    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:3000/api/feed/match");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("encodes the quote symbol in the query", async () => {
    const send = fakeFetch(() => Response.json(quote));
    const reply = await callDesk("http://localhost:3000", { type: "quote", symbol: "A B" }, send);
    expect(reply.ok).toBe(true);
    expect(send.mock.calls[0]?.[0]).toBe("http://localhost:3000/api/feed/quote?symbol=A%20B");
  });

  it("sends only the buy fields the desk expects", async () => {
    const send = fakeFetch(() => Response.json({ entry: entry() }));
    const reply = await callDesk("http://localhost:3000", { type: "buy", postId: "1", instrumentSymbol: "S", outcome: "no", amountCents: 200 }, send);
    expect(reply).toMatchObject({ ok: true, value: { kind: "approve" } });
    expect(JSON.parse(sentBody(send))).toEqual({ postId: "1", instrumentSymbol: "S", outcome: "no", amountCents: 200 });
  });

  it.each([
    ["desk offline", () => Promise.reject(new TypeError("offline")), "Can't reach the desk. Is it running?"],
    ["unconfigured desk", () => new Response("{}", { status: 503 }), "The desk is not configured."],
    ["foreign origin", () => new Response("{}", { status: 403 }), "The desk refused this extension."],
    ["unreadable body", () => new Response("<html>", { status: 200 }), "The desk sent an unreadable response."],
    ["wrong shape", () => Response.json({ nope: true }), "The desk sent an unexpected response."],
  ])("reports %s as a quiet error", async (_name, respond, error) => {
    const reply = await callDesk("http://localhost:3000", { type: "confirm", intentId: "i" }, fakeFetch(respond));
    expect(reply).toEqual({ ok: false, error });
  });
});

describe("protocol", () => {
  it("rejects malformed background messages", () => {
    expect(backgroundRequestSchema.safeParse({ type: "buy", postId: "1", instrumentSymbol: "S", outcome: "maybe", amountCents: 100 }).success).toBe(false);
    expect(backgroundRequestSchema.safeParse({ type: "buy", postId: "1", instrumentSymbol: "S", outcome: "yes", amountCents: 1.5 }).success).toBe(false);
    expect(backgroundRequestSchema.safeParse({ type: "other" }).success).toBe(false);
    expect(backgroundRequestSchema.safeParse({ type: "buy", postId: "1", instrumentSymbol: "S", outcome: "yes", amountCents: 100, senderId: "x" }).success).toBe(true);
  });

  it("accepts exactly what the desk's shared types describe", () => {
    const market: FeedQuote["market"] = {
      eventTicker: "FED261211", eventTitle: "Fed?", contractLabel: "Hold", instrumentSymbol: "S", yesCents: 62, noCents: 40,
      marketState: "open", category: "Sports", impliedYesPercent: 62, bestBidCents: null, bestAskCents: null, lastTradeCents: 62,
      tradeable: false, tradeBlockedReason: "Sports markets are outside the desk's news-trading policy.",
    };
    const quoteSample: FeedQuote = { market, history: [{ at: "2026-11-17T12:00:00.000Z", yesCents: 62 }] };
    const matchSample: FeedMatch = { kind: "matched", postId: "1", matchedBy: "keywords", confidence: 0.7, why: "why", market };
    const noMatchSample: FeedMatch = { kind: "no-match", postId: "1", matchedBy: "grok", reason: "none" };
    const entrySample: DecisionLogEntry = {
      entryId: "e", kind: "refuse", code: "market-category-not-allowed", spokenReason: "no", intentId: "i", symbol: "S", outcome: "yes",
      notionalCents: 100, senderId: "operator", source: "feed", at: "2026-11-17T12:00:00.000Z",
    };
    expect(feedQuoteSchema.parse(quoteSample)).toEqual(quoteSample);
    expect(feedMatchSchema.parse(matchSample)).toEqual(matchSample);
    expect(feedMatchSchema.parse(noMatchSample)).toEqual(noMatchSample);
    expect(decisionEntrySchema.parse(entrySample)).toMatchObject({ kind: "refuse", spokenReason: "no" });
  });
});
