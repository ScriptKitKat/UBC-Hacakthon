import { beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_HOST_ATTRIBUTE, createCard } from "./card-view";
import { entry, market, matched, quote } from "./fixtures";
import type { BackgroundReply } from "./protocol";
import type { WireEntry } from "./wire";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function trusted(event: Event): Event {
  Object.defineProperty(event, "isTrusted", { value: true });
  return event;
}

function press(element: HTMLElement): void {
  element.dispatchEvent(trusted(new MouseEvent("click", { bubbles: true, composed: true })));
}

function setup(card = matched) {
  const send = vi.fn();
  const handle = createCard(card, send);
  document.body.append(handle.host);
  const root = handle.host.shadowRoot;
  if (!root) throw new Error("card has no shadow root");
  const text = () => root.textContent;
  const button = (key: string) => root.querySelector<HTMLButtonElement>(`[data-key="${key}"]`) as HTMLButtonElement;
  return { send, handle, root, text, button };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const reply = (value: WireEntry): BackgroundReply<WireEntry> => ({ ok: true, value });

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("research link", () => {
  it("links to the research page in a new tab when a href is provided", () => {
    const handle = createCard(matched, vi.fn(), { researchHref: "http://localhost:3000/markets/GEMI-FED261211-MAINTAIN" });
    document.body.append(handle.host);
    const link = handle.host.shadowRoot?.querySelector<HTMLAnchorElement>('[data-key="research"]');
    expect(link?.getAttribute("href")).toBe("http://localhost:3000/markets/GEMI-FED261211-MAINTAIN");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toBe("Research ↗");
  });

  it("omits the link without a href", () => {
    const handle = createCard(matched, vi.fn());
    expect(handle.host.shadowRoot?.querySelector('[data-key="research"]')).toBeNull();
  });
});

describe("market card", () => {
  it("renders the market, prices, Grok badge, why line and footer", () => {
    const { text, handle, root } = setup();
    expect(handle.host.getAttribute(CARD_HOST_ATTRIBUTE)).toBe(matched.postId);
    expect(text()).toContain("Fed decision in December?");
    expect(text()).toContain("Fed maintains rate · Economics");
    expect(text()).toContain("YES 62¢");
    expect(text()).toContain("NO 40¢");
    expect(root.querySelector(".price")?.textContent).toBe("62¢");
    expect(root.querySelector(".change")).toBeNull();
    expect(root.querySelector(".badge")?.textContent).toBe("Grok");
    expect(text()).toContain(matched.why);
    expect(text()).toContain("Trade on Gemini · settled in USDC on Solana");
    expect(root.querySelector('[data-key="amount-100"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("labels the keyword fallback", () => {
    const { root } = setup({ ...matched, matchedBy: "keywords" });
    expect(root.querySelector(".badge")?.textContent).toBe("matched by keywords");
  });

  it("shows a probability bar until there is enough history, then a sparkline", () => {
    const { root, handle } = setup();
    expect(root.querySelector(".bar")).not.toBeNull();
    expect(root.querySelector("path.line")).toBeNull();
    handle.update(quote);
    expect(root.querySelector("path.line")?.getAttribute("data-trend")).toBe("up");
    expect(root.querySelector(".bar")).toBeNull();
    expect(root.textContent).toContain("YES 65¢");
    expect(root.querySelector(".change")?.textContent).toBe("+8.3%");
  });

  it("keeps the probability bar when history has fewer than three distinct points", () => {
    const { root, handle } = setup();
    handle.update({ ...quote, history: quote.history.slice(0, 2) });
    expect(root.querySelector(".bar")).not.toBeNull();
    expect(root.querySelector("path.line")).toBeNull();
    handle.update({ ...quote, history: quote.history.map((point) => ({ ...point, yesCents: 62 })) });
    expect(root.querySelector(".bar")).not.toBeNull();
    expect(root.querySelector(".change")?.textContent).toBe("0%");
  });

  it("gives each buy click a fresh client order id", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue({ ok: false, error: "no" });
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(root.textContent).toContain("no"); });
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(2); });
    const ids = send.mock.calls.map(([request]) => (request as { clientOrderId: string }).clientOrderId);
    expect(new Set(ids).size).toBe(2);
  });

  it("ignores events that did not come from the user", () => {
    const { send, button } = setup();
    button("amount-500").click();
    button("buy-yes").click();
    button("buy-yes").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(button("amount-500").getAttribute("aria-pressed")).toBe("false");
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores synthetic approvals", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValueOnce(reply(entry({ kind: "needs-approval", intentId: "intent-9" })));
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="approval"]')).not.toBeNull(); });
    button("approve").click();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops pointer and keyboard events from reaching the tweet", () => {
    const { button } = setup();
    const outside = vi.fn();
    document.body.addEventListener("click", outside);
    document.body.addEventListener("keydown", outside);
    press(button("amount-200"));
    button("amount-200").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(outside).not.toHaveBeenCalled();
  });

  it("buys with the chosen amount and outcome, disabling controls while pending", async () => {
    const pending = deferred<BackgroundReply<WireEntry>>();
    const { send, button, text } = setup();
    send.mockReturnValue(pending.promise);
    press(button("amount-500"));
    press(button("buy-no"));
    press(button("buy-no"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: "buy", postId: matched.postId, instrumentSymbol: market.instrumentSymbol, outcome: "no", amountCents: 500,
      clientOrderId: expect.stringMatching(UUID) as string, seenPriceCents: 40,
    });
    expect(text()).toContain("Placing order…");
    expect(button("buy-yes").disabled).toBe(true);
    expect(button("buy-no").disabled).toBe(true);
    pending.resolve(reply(entry({ outcome: "no", notionalCents: 500 })));
    await vi.waitFor(() => { expect(text()).toContain("Filled"); });
    expect(button("buy-yes").disabled).toBe(false);
  });

  it("shows the fill with the ticket and an explorer link", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue(reply(entry()));
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="filled"]')).not.toBeNull(); });
    expect(root.textContent).toContain("$1 YES · 1.61 @ 0.62 · paper ticket ticket-1");
    const link = root.querySelector<HTMLAnchorElement>("a.link");
    expect(link?.textContent).toBe("View on Solana Explorer ↗");
    expect(link?.href).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
    expect(link?.rel).toBe("noopener noreferrer");
  });

  it("refuses to link non-https explorer urls", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue(reply(entry({ explorerUrl: "javascript:alert(1)" })));
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(root.textContent).toContain("Filled"); });
    expect(root.querySelector("a.link")).toBeNull();
  });

  it("shows guardrail refusals verbatim", async () => {
    const { send, button, root } = setup();
    const reason = "A $5 trade exceeds the $2 limit per trade.";
    send.mockResolvedValue(reply(entry({ kind: "refuse", spokenReason: reason, code: "over-per-trade-cap" })));
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="refused"]')).not.toBeNull(); });
    expect(root.querySelector(".result-detail")?.textContent).toBe(reason);
    expect(root.querySelector(".result-title")?.textContent).toBe("Refused");
  });

  it("asks for approval and confirms through the desk", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValueOnce(reply(entry({ kind: "needs-approval", spokenReason: "The $5 trade needs your approval.", intentId: "intent-9" })));
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="approval"]')).not.toBeNull(); });
    expect(root.textContent).toContain("The $5 trade needs your approval.");
    expect(button("buy-yes").disabled).toBe(true);
    send.mockResolvedValueOnce(reply(entry()));
    press(button("approve"));
    expect(send).toHaveBeenLastCalledWith({ type: "confirm", intentId: "intent-9" });
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="filled"]')).not.toBeNull(); });
  });

  it("keeps the approval prompt and shows the error when confirming fails", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValueOnce(reply(entry({ kind: "needs-approval", intentId: "intent-9" })));
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(button("approve")).not.toBeNull(); });
    send.mockResolvedValueOnce({ ok: false, error: "Can't reach the desk. Is it running?" });
    press(button("approve"));
    await vi.waitFor(() => { expect(root.textContent).toContain("Can't reach the desk. Is it running?"); });
    expect(button("approve").disabled).toBe(false);
  });

  it("shows desk errors quietly", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue({ ok: false, error: "The desk is not configured." });
    press(button("buy-yes"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="quiet"]')).not.toBeNull(); });
    expect(root.textContent).toContain("The desk is not configured.");
  });

  it("disables trading and explains why for blocked markets", () => {
    const reason = "Sports markets are outside the desk's news-trading policy.";
    const { button, text, send } = setup({ ...matched, market: { ...market, category: "Sports", tradeable: false, tradeBlockedReason: reason } });
    expect(text()).toContain(reason);
    expect(button("buy-yes").disabled).toBe(true);
    press(button("buy-yes"));
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus on the same control across re-renders", () => {
    const { button, root } = setup();
    button("amount-200").focus();
    press(button("amount-200"));
    expect(root.activeElement?.getAttribute("data-key")).toBe("amount-200");
  });
});
