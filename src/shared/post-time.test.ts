import { describe, expect, it } from "vitest";
import { tweetTimeMs } from "./post-time";

describe("tweetTimeMs", () => {
  it("decodes a snowflake status id into the post's created time", () => {
    expect(tweetTimeMs("2122556892543394292")).toBe(1_794_891_973_039);
  });

  it("returns null for a non-snowflake id", () => {
    expect(tweetTimeMs("p-local-1")).toBeNull();
    expect(tweetTimeMs("")).toBeNull();
  });
});
