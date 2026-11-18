import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesk } from "@/features/desk";
import { createPolicy } from "@/features/guardrails";
import { createUnconfiguredLedger } from "@/features/ledger";
import { ok } from "@/features/markets";
import { createFakeXClient, createXBot, getXBot } from "@/features/xbot";
import type { XClient } from "@/features/xbot";
import { instrumentSymbol, usdCents } from "@/shared";
import { GET as threads } from "./route";
import { POST as news } from "./news/route";
import { POST as poll } from "./poll/route";
import { POST as reply } from "./reply/route";

vi.mock("@/features/xbot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/xbot")>()),
  getXBot: vi.fn(),
}));

function makeBot(client: XClient = createFakeXClient()) {
  const policy = createPolicy({
    dailyCap: usdCents(2000),
    autoApproveMax: usdCents(200),
    perTradeMax: usdCents(1000),
    marketAllowlist: new Set([instrumentSymbol("GEMI-A-B")]),
    senderAllowlist: new Set(["@priscilla"]),
    killSwitch: false,
  });
  if (!policy.ok) throw new Error("invalid policy");
  const desk = createDesk({
    policy: policy.value,
    markets: {
      searchEvents: () => Promise.resolve(ok({ events: [], total: 0 })),
      getEvent: () => Promise.reject(new Error("unused")),
    },
    ledger: createUnconfiguredLedger(),
    ledgerView: { configured: false, missing: [] },
    now: () => new Date("2026-11-17T12:00:00Z"),
    idGen: () => crypto.randomUUID(),
  });
  return createXBot({ desk, client, now: () => new Date("2026-11-17T12:00:00Z"), idGen: () => crypto.randomUUID(), botHandle: "@bot", configuredMissing: ["X_API_KEY"] });
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x.test", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.mocked(getXBot).mockResolvedValue({ ok: true, bot: makeBot() });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("x api validation", () => {
  it.each([
    ["news text", news, { text: "", authorHandle: "@a" }],
    ["news handle", news, { text: "x" }],
    ["news url", news, { text: "x", authorHandle: "@a", url: "nope" }],
    ["reply thread", reply, { id: "r1", authorHandle: "@a", text: "yes 2" }],
    ["reply text", reply, { id: "r1", inReplyToId: "1", authorHandle: "@a", text: " " }],
    ["malformed json", news, "{"],
  ])("returns 400 for bad %s input", async (_name, handler, body) => {
    const response = await handler(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid-request" });
  });

  it("returns a generic error when the bot throws an error containing private details", async () => {
    vi.mocked(getXBot).mockRejectedValueOnce(new Error("private upstream credential"));
    const response = await threads();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "xbot-failed" });
  });

  it("returns 503 when the desk is not configured", async () => {
    vi.mocked(getXBot).mockResolvedValue({ ok: false, issues: ["DAILY_CAP_USD: missing"] });
    for (const response of [await threads(), await poll(), await news(post({ text: "x", authorHandle: "@a" }))]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: "desk-misconfigured", issues: ["DAILY_CAP_USD: missing"] });
    }
  });
});

describe("news webhook", () => {
  const body = { id: "t1", text: "Something unrelated happened", authorHandle: "@Wire" };

  it("accepts news without a token when XBOT_WEBHOOK_TOKEN is unset and exposes the thread", async () => {
    const response = await news(post(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "ingested", posted: false });
    const listing = (await (await threads()).json()) as { status: unknown; threads: { id: string }[] };
    expect(listing.status).toEqual({ mode: "fake", configuredMissing: ["X_API_KEY"] });
    expect(listing.threads.map((thread) => thread.id)).toEqual(["t1"]);
  });

  it("requires the bearer token when XBOT_WEBHOOK_TOKEN is set", async () => {
    vi.stubEnv("XBOT_WEBHOOK_TOKEN", "hook-token");
    for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: "hook-token" }, { authorization: "Bearer " }]) {
      const response = await news(post(body, headers));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    const accepted = await news(post(body, { authorization: "Bearer hook-token" }));
    expect(accepted.status).toBe(200);
  });

  it("checks the token before validating the body", async () => {
    vi.stubEnv("XBOT_WEBHOOK_TOKEN", "hook-token");
    expect((await news(post("{"))).status).toBe(401);
  });

  it("reports a repeated news id as a duplicate", async () => {
    await news(post(body));
    expect(await (await news(post(body))).json()).toEqual({ kind: "duplicate" });
  });
});

describe("simulated replies", () => {
  it("routes a reply into an existing thread", async () => {
    await news(post({ id: "t1", text: "Something unrelated happened", authorHandle: "@wire" }));
    const response = await reply(post({ id: "r1", inReplyToId: "t1", authorHandle: "@priscilla", text: "hello" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "handled" });
  });

  it("requires a reply id and handles concurrent requests with the same id once", async () => {
    await news(post({ id: "t1", text: "Something unrelated happened", authorHandle: "@wire" }));
    const body = { inReplyToId: "t1", authorHandle: "@priscilla", text: "yes 2" };
    expect((await reply(post(body))).status).toBe(400);
    const results = await Promise.all(
      [reply(post({ ...body, id: "r1" })), reply(post({ ...body, id: "r1" }))].map(async (response) => {
        const { result } = (await (await response).json()) as { result: string };
        return result;
      }),
    );
    expect(results.toSorted()).toEqual(["duplicate", "handled"]);
  });

  it("passes the raw sender handle to the bot for identity validation", async () => {
    const bot = makeBot();
    const handleReply = vi.spyOn(bot, "handleReply");
    vi.mocked(getXBot).mockResolvedValue({ ok: true, bot });
    await reply(post({ id: "r1", inReplyToId: "t1", authorHandle: " @priscilla ", text: "yes 2" }));
    expect(handleReply).toHaveBeenCalledWith(expect.objectContaining({ authorHandle: " @priscilla " }));
  });

  it("reports unknown threads as unrouted", async () => {
    expect(await (await reply(post({ id: "r1", inReplyToId: "nope", authorHandle: "@a", text: "yes 2" }))).json()).toEqual({ result: "unrouted" });
  });

  it("returns 409 in live mode", async () => {
    const live: XClient = { ...createFakeXClient(), mode: "live" };
    vi.mocked(getXBot).mockResolvedValue({ ok: true, bot: makeBot(live) });
    const response = await reply(post({ id: "r1", inReplyToId: "t1", authorHandle: "@a", text: "yes 2" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "live-mode" });
  });
});

describe("poll", () => {
  it("returns the poll summary", async () => {
    const response = await poll();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fetched: 0, handled: 0, duplicates: 0, unrouted: 0, ignored: 0 });
  });

  it("returns 502 with the error kind when X fails", async () => {
    const failing: XClient = {
      ...createFakeXClient(),
      fetchMentions: () => Promise.resolve({ ok: false, error: { kind: "rate-limited" } }),
    };
    vi.mocked(getXBot).mockResolvedValue({ ok: true, bot: makeBot(failing) });
    const response = await poll();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "rate-limited" });
  });
});
