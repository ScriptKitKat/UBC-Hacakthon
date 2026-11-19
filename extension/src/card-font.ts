import manrope from "./fonts/manrope-latin-variable.woff2";

const registered = new WeakSet<Document>();

export function ensureCardFont(document: Document): void {
  if (registered.has(document) || typeof FontFace === "undefined") return;
  registered.add(document);
  const font = new FontFace("NTD Manrope", manrope.buffer, { weight: "400 800", display: "swap" });
  document.fonts.add(font);
  void font.load().catch(() => document.fonts.delete(font));
}
