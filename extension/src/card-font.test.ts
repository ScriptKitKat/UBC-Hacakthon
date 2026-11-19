import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureCardFont } from "./card-font";

vi.mock("./fonts/manrope-latin-variable.woff2", () => ({ default: new Uint8Array([1, 2, 3]) }));

afterEach(() => { vi.unstubAllGlobals(); });

function setup() {
  const doc = document.implementation.createHTMLDocument();
  const add = vi.fn();
  const remove = vi.fn();
  Object.defineProperty(doc, "fonts", { value: { add, delete: remove } });
  const load = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const font = { load };
  const constructor = vi.fn(function () { return font; });
  vi.stubGlobal("FontFace", constructor);
  return { doc, add, remove, load, font, constructor };
}

describe("card font", () => {
  it("registers the bundled font bytes once per document without a remote request", () => {
    const { doc, add, load, font, constructor } = setup();
    ensureCardFont(doc);
    ensureCardFont(doc);
    expect(constructor).toHaveBeenCalledExactlyOnceWith("NTD Manrope", new Uint8Array([1, 2, 3]).buffer, { weight: "400 800", display: "swap" });
    expect(add).toHaveBeenCalledExactlyOnceWith(font);
    expect(load).toHaveBeenCalledOnce();
  });

  it("removes a failed font so the system fallback remains available", async () => {
    const { doc, load, font, remove } = setup();
    load.mockRejectedValue(new Error("invalid font"));
    ensureCardFont(doc);
    await vi.waitFor(() => { expect(remove).toHaveBeenCalledWith(font); });
  });

  it("keeps rendering available without the FontFace API", () => {
    const { doc, add } = setup();
    vi.stubGlobal("FontFace", undefined);
    expect(() => { ensureCardFont(doc); }).not.toThrow();
    expect(add).not.toHaveBeenCalled();
  });
});
