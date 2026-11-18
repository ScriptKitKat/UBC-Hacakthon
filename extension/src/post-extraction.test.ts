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
    expect(posts).toHaveLength(5);
    expect(posts[0]).toEqual({
      id: "1857300000000000001",
      text: "Fed officials signal they could hold rates steady at the December FOMC meeting, Powell says inflation progress has stalled.",
      author: "@reuters",
      url: "https://x.com/reuters/status/1857300000000000001",
    });
    expect(posts.map((post) => post?.id)).toEqual(Array.from({ length: 5 }, (_, index) => `185730000000000000${String(index + 1)}`));
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
