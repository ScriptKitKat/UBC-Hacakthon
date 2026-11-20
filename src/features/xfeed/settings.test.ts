import { describe, expect, it } from "vitest";
import { loadXFeedSettings } from "./settings";

describe("loadXFeedSettings", () => {
  it("trims a configured bearer token", () => {
    expect(loadXFeedSettings({ X_BEARER_TOKEN: " token " })).toEqual({ bearerToken: "token" });
  });

  it("treats a blank bearer token as missing", () => {
    expect(loadXFeedSettings({ X_BEARER_TOKEN: "  " })).toEqual({ bearerToken: undefined });
    expect(loadXFeedSettings({})).toEqual({ bearerToken: undefined });
  });
});
