import { describe, expect, it } from "vitest";
import { isLocalHost, parseDeskUrl, resolveDeskToken } from "./settings";

describe("desk url", () => {
  it.each([
    ["http://localhost:3000", "http://localhost:3000"],
    [" https://desk.example.com/some/path ", "https://desk.example.com"],
    ["http://127.0.0.1:3001/", "http://127.0.0.1:3001"],
    ["http://[::1]:3000", "http://[::1]:3000"],
  ])("normalises %s", (input, expected) => {
    expect(parseDeskUrl(input)).toBe(expected);
  });

  it.each(["", "localhost:3000", "ftp://desk", "javascript:alert(1)", "not a url", "http://desk.example.com", "http://192.168.1.5:3000", "http://localhost.evil.test"])("rejects %s", (input) => {
    expect(parseDeskUrl(input)).toBeUndefined();
  });

  it("detects hosts the manifest already covers", () => {
    expect(isLocalHost("http://localhost:3000")).toBe(true);
    expect(isLocalHost("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalHost("https://desk.example.com")).toBe(false);
  });
});

describe("desk token", () => {
  it("prefers a stored token and falls back to the built-in one", () => {
    expect(resolveDeskToken(" stored ", "baked")).toBe("stored");
    expect(resolveDeskToken("", "baked")).toBe("baked");
    expect(resolveDeskToken(undefined, "baked")).toBe("baked");
    expect(resolveDeskToken(42, "")).toBe("");
  });
});
