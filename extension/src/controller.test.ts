import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedController } from "./controller";
import { matched, quote } from "./fixtures";
import type { BackgroundReply, BackgroundRequest, Sender } from "./protocol";
import { TWEET_SELECTOR } from "./post-extraction";

const fixture = readFileSync(resolve(process.cwd(), "extension/fixtures/x-timeline.html"), "utf8");
const FED_ID = "1857300000000000001";
const FOOD_ID = "1857300000000000005";

function setup(respond: (request: BackgroundRequest) => BackgroundReply<unknown> = defaultReply) {
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/u.exec(fixture)?.[1] ?? "";
  const requests: BackgroundRequest[] = [];
  const send = ((request: BackgroundRequest) => {
    requests.push(request);
    return Promise.resolve(respond(request));
  }) as Sender;
  let notify: (element: Element, visible: boolean) => void = () => undefined;
  const observed: Element[] = [];
  const controller = createFeedController({
    document,
    send,
    watchVisibility: (onChange) => {
      notify = onChange;
      return { observe: (element) => { observed.push(element); } };
    },
    dwellMs: 300,
    refreshMs: 20_000,
    scanDebounceMs: 50,
  });
  const articles = () => [...document.querySelectorAll(TWEET_SELECTOR)];
  return { controller, requests, observed, articles, show: (index: number) => { notify(articles()[index] as Element, true); }, hide: (index: number) => { notify(articles()[index] as Element, false); } };
}

function defaultReply(request: BackgroundRequest): BackgroundReply<unknown> {
  if (request.type === "match") {
    return request.postId === FED_ID
      ? { ok: true, value: matched }
      : { ok: true, value: { kind: "no-match", postId: request.postId, matchedBy: "grok", reason: "none" } };
  }
  if (request.type === "quote") return { ok: true, value: quote };
  return { ok: false, error: "unsupported" };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("feed controller", () => {
  it("observes every top-level post but requests nothing until one dwells in view", async () => {
    const { controller, observed, requests, show } = setup();
    controller.start();
    expect(observed).toHaveLength(5);
    expect(requests).toEqual([]);
    show(0);
    await vi.advanceTimersByTimeAsync(299);
    expect(requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(requests[0]).toMatchObject({ type: "match", postId: FED_ID, author: "@reuters" });
  });

  it("does not match posts that scroll past before the dwell time", async () => {
    const { controller, requests, show, hide } = setup();
    controller.start();
    show(0);
    await vi.advanceTimersByTimeAsync(100);
    hide(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toEqual([]);
  });

  it("injects the card before the action bar and seeds then refreshes the quote", async () => {
    const { controller, requests, articles, show } = setup();
    controller.start();
    show(0);
    await vi.advanceTimersByTimeAsync(400);
    const article = articles()[0] as Element;
    const host = article.querySelector("[data-ntd-card]");
    expect(host).not.toBeNull();
    expect(host?.nextElementSibling?.querySelector('[role="group"]')).not.toBeNull();
    expect(requests.filter((request) => request.type === "quote")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(requests.filter((request) => request.type === "quote")).toHaveLength(2);
  });

  it("pauses quote refresh while the post is off screen", async () => {
    const { controller, requests, show, hide } = setup();
    controller.start();
    show(0);
    await vi.advanceTimersByTimeAsync(400);
    hide(0);
    const before = requests.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requests).toHaveLength(before);
  });

  it("injects nothing for non-news posts", async () => {
    const { controller, articles, requests, show } = setup();
    controller.start();
    show(4);
    await vi.advanceTimersByTimeAsync(400);
    expect(requests[0]).toMatchObject({ postId: FOOD_ID });
    expect(articles()[4]?.querySelector("[data-ntd-card]")).toBeNull();
    show(4);
    await vi.advanceTimersByTimeAsync(400);
    expect(requests.filter((request) => request.type === "match")).toHaveLength(1);
  });

  it("skips posts with very short text", async () => {
    const { controller, articles, requests, show } = setup();
    controller.start();
    const text = articles()[0]?.querySelector('[data-testid="tweetText"]');
    if (text) text.textContent = "Too short";
    show(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(requests).toEqual([]);
  });

  it("re-attaches the same card without a second match when X re-renders the node", async () => {
    const { controller, requests, articles, show } = setup();
    controller.start();
    show(0);
    await vi.advanceTimersByTimeAsync(400);
    const first = articles()[0]?.querySelector("[data-ntd-card]");
    articles()[0]?.querySelector("[data-ntd-card]")?.remove();
    show(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(articles()[0]?.querySelector("[data-ntd-card]")).toBe(first);
    expect(requests.filter((request) => request.type === "match")).toHaveLength(1);
  });

  it("picks up posts added later by the timeline", async () => {
    const { controller, observed } = setup();
    controller.start();
    const clone = document.querySelector(TWEET_SELECTOR)?.cloneNode(true);
    if (clone) document.body.append(clone);
    await vi.advanceTimersByTimeAsync(100);
    expect(observed).toHaveLength(6);
  });

  it("retries a failed match only after the back-off", async () => {
    let fail = true;
    const { controller, requests, show, hide } = setup((request) => (request.type === "match" && fail ? { ok: false, error: "down" } : defaultReply(request)));
    controller.start();
    show(0);
    await vi.advanceTimersByTimeAsync(400);
    hide(0);
    fail = false;
    show(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(requests.filter((request) => request.type === "match")).toHaveLength(1);
    hide(0);
    await vi.advanceTimersByTimeAsync(31_000);
    show(0);
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(requests.filter((request) => request.type === "match")).toHaveLength(2);
  });
});
