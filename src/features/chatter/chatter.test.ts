import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import type { XFeed, XPost } from "@/features/xfeed";
import { createChatter } from "./chatter";
import type { ChatterDeps } from "./chatter";
import { openChatterStore } from "./store";
import type { StoredChatter } from "./store";

const SYMBOL = "GEMI-NCAAM-2611210000-OAK-PUR-M-PUR";
const SIBLING = "GEMI-NCAAM-2611210000-OAK-PUR-M-OAK";
const EVENT = "NCAAM-2611210000-OAK-PUR-M";
const HOUR_MS = 60 * 60 * 1000;
const NOW = 1_795_000_000_000;

const post: XPost = { id: "1", text: "Purdue opens as a big favorite", authorUsername: "hoops", url: "https://x.com/hoops/status/1", createdAtMs: NOW - HOUR_MS };
const context = { source: "x-search", text: post.text, author: "@hoops", url: post.url, why: null, atMs: post.createdAtMs };

function setup(overrides: Partial<ChatterDeps> = {}) {
  let now = NOW;
  const recentPosts = vi.fn<XFeed["recentPosts"]>(() => Promise.resolve([post]));
  const eventTitle = vi.fn<ChatterDeps["eventTitle"]>(() => Promise.resolve("Oakland vs Purdue"));
  const saveChatter = vi.fn<NonNullable<ChatterDeps["saveChatter"]>>(() => Promise.resolve());
  const chatter = createChatter({ xFeed: { recentPosts }, eventTitle, nowMs: () => now, saveChatter, ...overrides });
  return { chatter, recentPosts, eventTitle, saveChatter, advance: (ms: number) => { now += ms; } };
}

describe("createChatter", () => {
  it("searches X with the event's query on load and saves the result", async () => {
    const { chatter, recentPosts, eventTitle, saveChatter } = setup();
    expect(await chatter.load(SYMBOL)).toEqual([context]);
    expect(eventTitle).toHaveBeenCalledWith(EVENT);
    expect(recentPosts).toHaveBeenCalledWith("oakland purdue");
    expect(saveChatter).toHaveBeenCalledWith([{ eventTicker: EVENT, fetchedAtMs: NOW, posts: [context] }]);
  });

  it("never searches when only peeking", () => {
    const { chatter, recentPosts } = setup();
    expect(chatter.peek(SYMBOL)).toEqual([]);
    expect(recentPosts).not.toHaveBeenCalled();
  });

  it("shares one search across every contract of the event within the hour", async () => {
    const { chatter, recentPosts, advance } = setup();
    await chatter.load(SYMBOL);
    advance(HOUR_MS - 1);
    expect(await chatter.load(SIBLING)).toEqual([context]);
    expect(chatter.peek(SIBLING)).toEqual([context]);
    expect(recentPosts).toHaveBeenCalledTimes(1);
    advance(1);
    await chatter.load(SYMBOL);
    expect(recentPosts).toHaveBeenCalledTimes(2);
  });

  it("joins a search already in flight instead of starting another", async () => {
    const { chatter, recentPosts } = setup();
    const [first, second] = await Promise.all([chatter.load(SYMBOL), chatter.load(SIBLING)]);
    expect(first).toEqual(second);
    expect(recentPosts).toHaveBeenCalledTimes(1);
  });

  it("keeps the last posts when a refresh fails, and retries on the next load", async () => {
    const { chatter, recentPosts, saveChatter, advance } = setup();
    await chatter.load(SYMBOL);
    advance(HOUR_MS);
    recentPosts.mockResolvedValueOnce(undefined);
    expect(await chatter.load(SYMBOL)).toEqual([context]);
    expect(saveChatter).toHaveBeenCalledTimes(1);
    await chatter.load(SYMBOL);
    expect(recentPosts).toHaveBeenCalledTimes(3);
  });

  it("skips the search when the event title is unavailable", async () => {
    const { chatter, recentPosts } = setup({ eventTitle: () => Promise.resolve(undefined) });
    expect(await chatter.load(SYMBOL)).toEqual([]);
    expect(recentPosts).not.toHaveBeenCalled();
  });

  it("ignores a malformed symbol", async () => {
    const { chatter, recentPosts } = setup();
    expect(await chatter.load("nope")).toEqual([]);
    expect(chatter.peek("nope")).toEqual([]);
    expect(recentPosts).not.toHaveBeenCalled();
  });

  it("serves saved chatter after a restart without searching again", async () => {
    const fs = createMemoryFileSystem();
    const path = "/data/x-chatter.json";
    const first = await openChatterStore({ fs, path });
    const { chatter } = setup({ saveChatter: first.saveChatter });
    await chatter.load(SYMBOL);
    await vi.waitFor(async () => {
      expect((await openChatterStore({ fs, path })).initialChatter).toHaveLength(1);
    });

    const reopened = await openChatterStore({ fs, path });
    const restarted = setup({ initialChatter: reopened.initialChatter });
    expect(restarted.chatter.peek(SYMBOL)).toEqual([context]);
    expect(await restarted.chatter.load(SYMBOL)).toEqual([context]);
    expect(restarted.recentPosts).not.toHaveBeenCalled();
  });

  it("keeps only the most recently fetched events", async () => {
    const initialChatter: StoredChatter[] = Array.from({ length: 500 }, (_, index) => ({ eventTicker: `OLD${String(index)}`, fetchedAtMs: NOW - HOUR_MS - index, posts: [] }));
    const { chatter, saveChatter } = setup({ initialChatter });
    await chatter.load(SYMBOL);
    const saved = saveChatter.mock.calls[0]?.[0] ?? [];
    expect(saved).toHaveLength(500);
    expect(saved[0]?.eventTicker).toBe(EVENT);
    expect(saved.some((entry) => entry.eventTicker === "OLD499")).toBe(false);
  });
});
