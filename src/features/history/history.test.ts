import { describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/features/markets";
import type { GeminiMarketsClient, MarketContract, MarketEvent } from "@/features/markets";
import { createMemoryFileSystem } from "@/features/storage";
import { instrumentSymbol } from "@/shared";
import { createSampler } from "./sampler";
import { createMemoryHistory, openHistoryStore } from "./store";

const PATH = "/data/price-history.json";
const A = "GEMI-FED261211-MAINTAIN";
const B = "GEMI-FED261211-CUT25";
const C = "GEMI-NBA-2611190030-CHI-BKN-S-CHI27";

const snap = (atMs: number, yesCents: number, bidCents: number | null = null, askCents: number | null = null) => ({ atMs, yesCents, bidCents, askCents });

describe("history store", () => {
  it("records points per symbol in order and marks them watched", async () => {
    const store = await openHistoryStore({ fs: createMemoryFileSystem(), path: PATH });
    store.record(A, snap(1_000_000, 60, 58, 60));
    store.record(A, snap(1_040_000, 62, 60, 62));
    store.record(B, snap(1_000_000, 30));
    expect(store.series(A)).toEqual([snap(1_000_000, 60, 58, 60), snap(1_040_000, 62, 60, 62)]);
    expect(store.series("GEMI-X-Y")).toEqual([]);
    expect(store.watched()).toEqual([A, B]);
  });

  it("drops points that arrive within the minimum gap", async () => {
    const store = await openHistoryStore({ fs: createMemoryFileSystem(), path: PATH, limits: { minGapMs: 10_000 } });
    store.record(A, snap(100_000, 60));
    store.record(A, snap(105_000, 61));
    store.record(A, snap(110_000, 62));
    expect(store.series(A).map((point) => point.yesCents)).toEqual([60, 62]);
  });

  it("bounds the points kept per symbol to the newest", async () => {
    const store = await openHistoryStore({ fs: createMemoryFileSystem(), path: PATH, limits: { maxPoints: 3, minGapMs: 1 } });
    for (let index = 0; index < 6; index += 1) store.record(A, snap(index * 1000, index));
    expect(store.series(A).map((point) => point.yesCents)).toEqual([3, 4, 5]);
  });

  it("evicts the least recently watched symbol beyond the bound", async () => {
    const store = await openHistoryStore({ fs: createMemoryFileSystem(), path: PATH, limits: { maxWatched: 2 } });
    store.record(A, snap(1000, 10));
    store.record(B, snap(1000, 20));
    store.watch(A);
    store.record(C, snap(1000, 30));
    expect(store.watched()).toEqual([A, C]);
    expect(store.series(B)).toEqual([]);
    expect(store.series(A)).toHaveLength(1);
  });

  it("watching an unseen symbol starts an empty series", async () => {
    const store = await openHistoryStore({ fs: createMemoryFileSystem(), path: PATH });
    store.watch(A);
    expect(store.watched()).toEqual([A]);
    expect(store.series(A)).toEqual([]);
  });

  it("persists on flush and survives a restart", async () => {
    const fs = createMemoryFileSystem();
    const store = await openHistoryStore({ fs, path: PATH });
    store.record(A, snap(1_000_000, 60, 58, 60));
    store.record(B, snap(1_000_000, 30, null, 31));
    await store.flush();
    const restarted = await openHistoryStore({ fs, path: PATH });
    expect(restarted.watched()).toEqual([A, B]);
    expect(restarted.series(A)).toEqual([snap(1_000_000, 60, 58, 60)]);
    expect(restarted.series(B)).toEqual([snap(1_000_000, 30, null, 31)]);
  });

  it("only writes when something changed", async () => {
    const fs = createMemoryFileSystem();
    const store = await openHistoryStore({ fs, path: PATH });
    await store.flush();
    expect(fs.writes).toHaveLength(0);
    store.record(A, snap(1_000_000, 60));
    await store.flush();
    await store.flush();
    expect(fs.writes).toHaveLength(1);
  });

  it("rebuilds from an empty store when the file is corrupted", async () => {
    const fs = createMemoryFileSystem({ [PATH]: "}{" });
    const store = await openHistoryStore({ fs, path: PATH });
    expect(store.watched()).toEqual([]);
    store.record(A, snap(1_000_000, 60));
    await store.flush();
    expect((await openHistoryStore({ fs, path: PATH })).series(A)).toHaveLength(1);
  });

  it("ignores a file with out-of-range prices", async () => {
    const fs = createMemoryFileSystem({ [PATH]: JSON.stringify({ version: 1, watched: [A], points: { [A]: [[1, 140, null, null]] } }) });
    expect((await openHistoryStore({ fs, path: PATH })).series(A)).toEqual([]);
  });

  it("retries a failed flush on the next call", async () => {
    const memory = createMemoryFileSystem();
    let failing = true;
    const fs = { ...memory, writeTextAtomic: (path: string, text: string) => (failing ? Promise.reject(new Error("disk full")) : memory.writeTextAtomic(path, text)) };
    const store = await openHistoryStore({ fs, path: PATH });
    store.record(A, snap(1_000_000, 60));
    await expect(store.flush()).rejects.toThrow("disk full");
    failing = false;
    await store.flush();
    expect(memory.writes).toHaveLength(1);
  });

  it("trims persisted data beyond the configured bounds on load", async () => {
    const fs = createMemoryFileSystem();
    const first = await openHistoryStore({ fs, path: PATH, limits: { minGapMs: 1 } });
    for (let index = 0; index < 5; index += 1) first.record(A, snap(index * 1000, index));
    await first.flush();
    const second = await openHistoryStore({ fs, path: PATH, limits: { maxPoints: 2 } });
    expect(second.series(A).map((point) => point.yesCents)).toEqual([3, 4]);
  });
});

function contract(symbol: string, yes: number | null, bid: number | null, ask: number | null): MarketContract {
  return {
    instrumentSymbol: instrumentSymbol(symbol),
    label: symbol,
    description: "",
    expiryDate: null,
    marketState: "open",
    status: "active",
    prices: { bestBidCents: bid, bestAskCents: ask, lastTradeCents: null, buyYesCents: yes, buyNoCents: null, sellYesCents: null, sellNoCents: null },
    limits: null,
  };
}

function event(ticker: string, contracts: MarketContract[]): MarketEvent {
  return { ticker, title: ticker, category: "Economics", status: "active", expiryDate: null, description: "", subcategory: null, volume: null, volume24h: null, tags: [], contracts };
}

describe("memory history", () => {
  it("records and flushes without touching disk", async () => {
    const store = createMemoryHistory();
    store.record(A, snap(1_000_000, 60));
    await store.flush();
    expect(store.series(A)).toHaveLength(1);
  });
});

describe("sampler", () => {
  async function setup(getEvent: GeminiMarketsClient["getEvent"]) {
    const fs = createMemoryFileSystem();
    const history = await openHistoryStore({ fs, path: PATH });
    let clock = 1_000_000;
    const sampler = createSampler({ history, markets: { getEvent }, nowMs: () => (clock += 60_000) });
    return { history, sampler, fs };
  }

  it("samples each watched symbol once per event and persists", async () => {
    const getEvent = vi.fn<GeminiMarketsClient["getEvent"]>(() =>
      Promise.resolve(ok(event("FED261211", [contract(A, 62, 60, 62), contract(B, 30, 28, 30), contract("GEMI-FED261211-HIKE25", 5, 4, 5)]))),
    );
    const { history, sampler, fs } = await setup(getEvent);
    history.watch(A);
    history.watch(B);
    await sampler.sampleOnce();
    expect(getEvent).toHaveBeenCalledTimes(1);
    expect(getEvent).toHaveBeenCalledWith("FED261211", { refresh: true });
    expect(history.series(A)).toHaveLength(1);
    expect(history.series(A)[0]).toMatchObject({ yesCents: 62, bidCents: 60, askCents: 62 });
    expect(history.series(B)[0]).toMatchObject({ yesCents: 30 });
    expect(history.series("GEMI-FED261211-HIKE25")).toEqual([]);
    expect(fs.writes).toHaveLength(1);
  });

  it("resolves hyphenated event tickers", async () => {
    const getEvent = vi.fn<GeminiMarketsClient["getEvent"]>(() => Promise.resolve(ok(event("NBA-2611190030-CHI-BKN-S", [contract(C, 40, 39, 41)]))));
    const { history, sampler } = await setup(getEvent);
    history.watch(C);
    await sampler.sampleOnce();
    expect(getEvent).toHaveBeenCalledWith("NBA-2611190030-CHI-BKN-S", { refresh: true });
    expect(history.series(C)).toHaveLength(1);
  });

  it("skips contracts without a yes price and survives Gemini failures", async () => {
    const getEvent = vi
      .fn<GeminiMarketsClient["getEvent"]>()
      .mockResolvedValueOnce(ok(event("FED261211", [contract(A, null, null, null)])))
      .mockResolvedValueOnce(fail({ kind: "http", status: 500 }))
      .mockRejectedValueOnce(new Error("boom"));
    const { history, sampler } = await setup(getEvent);
    history.watch(A);
    await sampler.sampleOnce();
    await sampler.sampleOnce();
    await sampler.sampleOnce();
    expect(history.series(A)).toEqual([]);
  });

  it("ignores watched symbols that are not Gemini instruments", async () => {
    const getEvent = vi.fn<GeminiMarketsClient["getEvent"]>();
    const { history, sampler } = await setup(getEvent);
    history.watch("not-a-symbol");
    await sampler.sampleOnce();
    expect(getEvent).not.toHaveBeenCalled();
  });

  it("does not overlap passes", async () => {
    let release: () => void = () => undefined;
    const getEvent = vi.fn<GeminiMarketsClient["getEvent"]>(() => new Promise((resolve) => {
      release = () => { resolve(ok(event("FED261211", [contract(A, 62, 60, 62)]))); };
    }));
    const { history, sampler } = await setup(getEvent);
    history.watch(A);
    const first = sampler.sampleOnce();
    await sampler.sampleOnce();
    release();
    await first;
    expect(getEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps sampling when persisting fails", async () => {
    const memory = createMemoryFileSystem();
    const fs = { ...memory, writeTextAtomic: () => Promise.reject(new Error("read-only")) };
    const history = await openHistoryStore({ fs, path: PATH });
    const getEvent = vi.fn<GeminiMarketsClient["getEvent"]>(() => Promise.resolve(ok(event("FED261211", [contract(A, 62, 60, 62)]))));
    const sampler = createSampler({ history, markets: { getEvent }, nowMs: () => 5_000_000 });
    history.watch(A);
    await expect(sampler.sampleOnce()).resolves.toBeUndefined();
    expect(history.series(A)).toHaveLength(1);
  });

  it("starts and stops its schedule once", async () => {
    const stop = vi.fn();
    const schedule = vi.fn<(task: () => void, intervalMs: number) => () => void>(() => stop);
    const history = await openHistoryStore({ fs: createMemoryFileSystem(), path: PATH });
    const sampler = createSampler({ history, markets: { getEvent: vi.fn() }, nowMs: () => 0, schedule, intervalMs: 30_000 });
    sampler.start();
    sampler.start();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]?.[1]).toBe(30_000);
    sampler.stop();
    sampler.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
