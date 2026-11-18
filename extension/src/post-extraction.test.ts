import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { TWEET_SELECTOR, extractPost, isTopLevelTweet } from "./post-extraction";

const fixture = readFileSync(resolve(process.cwd(), "extension/fixtures/x-timeline.html"), "utf8");

beforeEach(() => {
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/u.exec(fixture)?.[1] ?? "";
});

describe("extractPost", () => {
  it("reads id, text, author and url from every fixture post", () => {
    const posts = [...document.querySelectorAll(TWEET_SELECTOR)].map((article) => extractPost(article));
    expect(posts.map((post) => post?.id)).toEqual([
      "2122621916934500390",
      "2122569858189861012",
      "2121332661851709507",
      "2122556892543394292",
      "2122900000000000005",
    ]);
    expect(posts[3]).toEqual({
      id: "2122556892543394292",
      text: "8-1 49ers vs 7-2 Vikings on Sunday Night Football. SF by 3.",
      author: "@joinantic",
      url: "https://x.com/joinantic/status/2122556892543394292",
    });
  });

  it("includes emoji alt text in the post text", () => {
    const article = document.querySelectorAll(TWEET_SELECTOR)[4] as Element;
    expect(extractPost(article)?.text).toBe("Good morning☕ coffee time and a slow Sunday ahead, no notes.");
  });

  it("uses the outer post's own text, author and time link when it quotes another post", () => {
    const article = document.querySelectorAll(TWEET_SELECTOR)[0] as Element;
    expect(article.querySelector('div[role="link"] [data-testid="tweetText"]')?.textContent).toContain("Wall Street");
    expect(extractPost(article)).toMatchObject({
      id: "2122621916934500390",
      author: "@Jeremybtc",
      text: expect.stringMatching(/^POLYMARKET PUTS DECEMBER FED RATE HIKE ODDS/u) as string,
    });
    expect(extractPost(article)?.text).not.toContain("Wall Street");
  });

  it("ignores a quoted post's time link and text even when the outer post has no text of its own", () => {
    document.body.innerHTML = `<article data-testid="tweet">
      <div data-testid="User-Name"><a href="/outer"><span>@outer</span></a><a href="/outer/status/111"><time>1h</time></a></div>
      <div role="link" tabindex="0">
        <div data-testid="User-Name"><a href="/quoted"><span>@quoted</span></a><a href="/quoted/status/222"><time>2h</time></a></div>
        <div data-testid="tweetText">Quoted words that belong to someone else</div>
      </div></article>`;
    const article = document.querySelector(TWEET_SELECTOR);
    expect(article && extractPost(article)).toBeUndefined();
  });

  it("falls back to the page path for the focal post on a status page", () => {
    document.body.innerHTML = `<article data-testid="tweet">
      <div data-testid="User-Name"><a href="/focal"><span>@focal</span></a></div>
      <div data-testid="tweetText">The focal post has no time link wrapper</div></article>`;
    const article = document.querySelector(TWEET_SELECTOR) as Element;
    expect(extractPost(article, "/focal/status/12345")).toMatchObject({ id: "12345", author: "@focal", url: "https://x.com/focal/status/12345" });
    expect(extractPost(article, "/home")).toBeUndefined();
  });

  it("ignores status links that do not wrap a time element", () => {
    document.body.innerHTML = `<article data-testid="tweet">
      <a href="/someone/status/999"><span>quoted</span></a>
      <a href="/real/status/123/analytics"><time>1h</time></a>
      <div data-testid="tweetText">  Some   text
        spanning lines  </div></article>`;
    const article = document.querySelector(TWEET_SELECTOR);
    expect(article && extractPost(article)).toMatchObject({ id: "123", text: "Some text spanning lines", author: "@real" });
  });

  it("returns undefined without text or a time link", () => {
    document.body.innerHTML = `<article data-testid="tweet"><a href="/a/status/1"><time>1h</time></a></article>
      <article data-testid="tweet"><div data-testid="tweetText">hello there everyone</div></article>`;
    for (const article of document.querySelectorAll(TWEET_SELECTOR)) expect(extractPost(article)).toBeUndefined();
  });

  it("treats nested quoted tweets as non top-level", () => {
    document.body.innerHTML = `<article data-testid="tweet" id="outer"><div><article data-testid="tweet" id="inner"></article></div></article>`;
    expect(isTopLevelTweet(document.querySelector("#outer") as Element)).toBe(true);
    expect(isTopLevelTweet(document.querySelector("#inner") as Element)).toBe(false);
  });
});
