import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPageTheme, parseCssColor, subscribePageTheme, themeFromBackground } from "./card-theme";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("themeFromBackground", () => {
  it("maps color strings to light or dark, including X Default, Dim, and Lights out", () => {
    expect(themeFromBackground("#FFFFFF")).toBe("light");
    expect(themeFromBackground("#fff")).toBe("light");
    expect(themeFromBackground("white")).toBe("light");
    expect(themeFromBackground("rgb(255, 255, 255)")).toBe("light");
    expect(themeFromBackground("rgb(255 255 255)")).toBe("light");
    expect(themeFromBackground("#15202B")).toBe("dark");
    expect(themeFromBackground("rgb(21, 32, 43)")).toBe("dark");
    expect(themeFromBackground("#000000")).toBe("dark");
    expect(themeFromBackground("#000")).toBe("dark");
    expect(themeFromBackground("black")).toBe("dark");
    expect(themeFromBackground("rgb(0, 0, 0)")).toBe("dark");
  });

  it("treats transparent or unparsable backgrounds as undetectable", () => {
    expect(themeFromBackground("transparent")).toBeUndefined();
    expect(themeFromBackground("rgba(0, 0, 0, 0)")).toBeUndefined();
    expect(themeFromBackground("rgb(255 255 255 / 0)")).toBeUndefined();
    expect(themeFromBackground("")).toBeUndefined();
    expect(themeFromBackground("not-a-color")).toBeUndefined();
    expect(parseCssColor("rgba(0, 0, 0, 0)")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("falls back to luminance for other opaque colors", () => {
    expect(themeFromBackground("rgb(248, 250, 252)")).toBe("light");
    expect(themeFromBackground("rgb(15, 23, 42)")).toBe("dark");
  });
});

describe("detectPageTheme", () => {
  it("reads the computed body background", () => {
    document.body.style.backgroundColor = "#15202B";
    expect(detectPageTheme(document)).toBe("dark");
    document.body.style.backgroundColor = "#FFFFFF";
    expect(detectPageTheme(document)).toBe("light");
    document.body.style.backgroundColor = "#000000";
    expect(detectPageTheme(document)).toBe("dark");
  });

  it("falls back to prefers-color-scheme when detection fails", () => {
    document.body.style.backgroundColor = "transparent";
    document.documentElement.style.backgroundColor = "transparent";
    const matchMedia = vi.spyOn(window, "matchMedia");
    const media = (matches: boolean, query: string): MediaQueryList => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    } as unknown as MediaQueryList);
    matchMedia.mockImplementation((query) => media(query.includes("prefers-color-scheme: dark"), query));
    expect(detectPageTheme(document)).toBe("dark");
    matchMedia.mockImplementation((query) => media(false, query));
    expect(detectPageTheme(document)).toBe("light");
  });
});

describe("subscribePageTheme", () => {
  it("reacts when the body background changes", async () => {
    document.body.style.backgroundColor = "#FFFFFF";
    const host = document.createElement("div");
    document.body.append(host);
    const seen: string[] = [];
    const stop = subscribePageTheme(document, host, (theme) => { seen.push(theme); });
    expect(seen).toEqual(["light"]);
    document.body.style.backgroundColor = "#000000";
    await vi.waitFor(() => { expect(seen.at(-1)).toBe("dark"); });
    document.body.style.backgroundColor = "#15202B";
    await vi.waitFor(() => { expect(seen.at(-1)).toBe("dark"); });
    document.body.style.backgroundColor = "#FFFFFF";
    await vi.waitFor(() => { expect(seen.at(-1)).toBe("light"); });
    stop();
  });
});
