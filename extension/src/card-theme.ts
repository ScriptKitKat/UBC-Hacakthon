export type PageTheme = "light" | "dark";

export interface CssRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const X_LIGHT = { r: 255, g: 255, b: 255 };
const X_DIM = { r: 21, g: 32, b: 43 };
const X_LIGHTS_OUT = { r: 0, g: 0, b: 0 };
const NEAR = 12;
const LUMINANCE_CUTOFF = 0.4;
const WATCH_MS = 1000;

function channel(raw: string): number {
  const value = raw.trim();
  if (value.endsWith("%")) return Math.max(0, Math.min(255, Math.round(Number.parseFloat(value) * 2.55)));
  return Number(value);
}

function alpha(raw: string): number {
  const value = raw.trim();
  if (value.endsWith("%")) return Math.max(0, Math.min(1, Number.parseFloat(value) / 100));
  return Number(value);
}

export function parseCssColor(input: string): CssRgb | undefined {
  const value = input.trim().toLowerCase();
  if (value === "" || value === "transparent" || value === "none") return undefined;
  if (value === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (value === "black") return { r: 0, g: 0, b: 0, a: 1 };
  const hex = /^#([0-9a-f]{3,8})$/u.exec(value);
  if (hex) {
    const digits = hex[1] ?? "";
    if (digits.length === 3 || digits.length === 4) {
      const r = Number.parseInt((digits[0] ?? "0") + (digits[0] ?? "0"), 16);
      const g = Number.parseInt((digits[1] ?? "0") + (digits[1] ?? "0"), 16);
      const b = Number.parseInt((digits[2] ?? "0") + (digits[2] ?? "0"), 16);
      const a = digits.length === 4 ? Number.parseInt((digits[3] ?? "f") + (digits[3] ?? "f"), 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (digits.length === 6 || digits.length === 8) {
      const r = Number.parseInt(digits.slice(0, 2), 16);
      const g = Number.parseInt(digits.slice(2, 4), 16);
      const b = Number.parseInt(digits.slice(4, 6), 16);
      const a = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return undefined;
  }
  const rgb = /^rgba?\((.+)\)$/u.exec(value);
  if (rgb === null) return undefined;
  const inner = rgb[1] ?? "";
  const [main, slashAlpha] = inner.split("/", 2);
  const tokens = (main ?? "").trim().split(/[\s,]+/u).filter(Boolean);
  if (tokens.length < 3) return undefined;
  const r = channel(tokens[0] ?? "");
  const g = channel(tokens[1] ?? "");
  const b = channel(tokens[2] ?? "");
  const a = slashAlpha !== undefined
    ? alpha(slashAlpha)
    : tokens[3] !== undefined
      ? alpha(tokens[3])
      : 1;
  if (![r, g, b, a].every(Number.isFinite)) return undefined;
  return { r, g, b, a };
}

function srgb(channelValue: number): number {
  const x = channelValue / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: CssRgb): number {
  return 0.2126 * srgb(color.r) + 0.7152 * srgb(color.g) + 0.0722 * srgb(color.b);
}

function near(color: CssRgb, target: { r: number; g: number; b: number }): boolean {
  return Math.abs(color.r - target.r) <= NEAR
    && Math.abs(color.g - target.g) <= NEAR
    && Math.abs(color.b - target.b) <= NEAR;
}

export function themeFromBackground(color: string): PageTheme | undefined {
  const rgb = parseCssColor(color);
  if (rgb === undefined || rgb.a < 0.5) return undefined;
  if (near(rgb, X_LIGHT)) return "light";
  if (near(rgb, X_DIM) || near(rgb, X_LIGHTS_OUT)) return "dark";
  return relativeLuminance(rgb) > LUMINANCE_CUTOFF ? "light" : "dark";
}

function backgroundsToRead(doc: Document, from?: Element | null): Element[] {
  const elements: Element[] = [];
  let node: Element | null = from ?? null;
  while (node !== null) {
    elements.push(node);
    node = node.parentElement;
  }
  if (!elements.includes(doc.body)) elements.push(doc.body);
  if (!elements.includes(doc.documentElement)) elements.push(doc.documentElement);
  return elements;
}

export function detectPageTheme(doc: Document, from?: Element | null): PageTheme {
  const view = doc.defaultView;
  for (const element of backgroundsToRead(doc, from)) {
    const color = view?.getComputedStyle(element).backgroundColor ?? "";
    const theme = themeFromBackground(color);
    if (theme !== undefined) return theme;
  }
  return view?.matchMedia("(prefers-color-scheme: dark)").matches === true ? "dark" : "light";
}

interface ThemeSub {
  readonly host: Element;
  readonly fn: (theme: PageTheme) => void;
  seen: boolean;
}

interface DocWatch {
  readonly observer: MutationObserver;
  readonly timer: number | undefined;
  readonly media: MediaQueryList | undefined;
  readonly onMedia: () => void;
  readonly notify: () => void;
}

const subs = new Set<ThemeSub>();
const watches = new WeakMap<Document, DocWatch>();

function prune(): void {
  for (const sub of [...subs]) {
    if (sub.seen && !sub.host.isConnected) subs.delete(sub);
  }
}

function notify(doc: Document): void {
  prune();
  const pending = [...subs].filter((sub) => sub.host.ownerDocument === doc);
  for (const sub of pending) {
    if (sub.host.isConnected) sub.seen = true;
    else if (sub.seen) {
      subs.delete(sub);
      continue;
    }
    sub.fn(detectPageTheme(doc, sub.host));
  }
  if ([...subs].every((sub) => sub.host.ownerDocument !== doc)) stopWatching(doc);
}

function stopWatching(doc: Document): void {
  const watch = watches.get(doc);
  if (watch === undefined) return;
  watch.observer.disconnect();
  if (watch.timer !== undefined) doc.defaultView?.clearInterval(watch.timer);
  watch.media?.removeEventListener("change", watch.onMedia);
  watches.delete(doc);
}

function ensureWatching(doc: Document): void {
  if (watches.has(doc)) return;
  const observer = new MutationObserver(() => { notify(doc); });
  const options: MutationObserverInit = { attributes: true, attributeFilter: ["class", "style", "data-theme"] };
  observer.observe(doc.documentElement, options);
  observer.observe(doc.body, options);
  const onMedia = (): void => { notify(doc); };
  const media = doc.defaultView?.matchMedia("(prefers-color-scheme: dark)");
  media?.addEventListener("change", onMedia);
  const timer = doc.defaultView?.setInterval(() => { notify(doc); }, WATCH_MS);
  watches.set(doc, { observer, timer, media, onMedia, notify: () => { notify(doc); } });
}

export function subscribePageTheme(doc: Document, host: Element, fn: (theme: PageTheme) => void): () => void {
  prune();
  const sub: ThemeSub = { host, fn, seen: host.isConnected };
  subs.add(sub);
  fn(detectPageTheme(doc, host));
  ensureWatching(doc);
  return () => {
    subs.delete(sub);
    if ([...subs].every((item) => item.host.ownerDocument !== doc)) stopWatching(doc);
  };
}
