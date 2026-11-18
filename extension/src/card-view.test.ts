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

const reply = (value: WireEntry): BackgroundReply<WireEntry> => ({ ok: true, value });

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("market card", () => {
  it("renders the market, prices, Grok badge, why line and footer", () => {
    const { text, handle, root } = setup();
    expect(handle.host.getAttribute(CARD_HOST_ATTRIBUTE)).toBe(matched.postId);
    expect(text()).toContain("Fed decision in December?");
    expect(text()).toContain("Fed maintains rate · Economics");
    expect(text()).toContain("YES 62¢");
    expect(text()).toContain("NO 40¢");
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
  });

  it("stops pointer and keyboard events from reaching the tweet", () => {
    const { button } = setup();
    const outside = vi.fn();
    document.body.addEventListener("click", outside);
    document.body.addEventListener("keydown", outside);
    button("amount-200").click();
    button("amount-200").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(outside).not.toHaveBeenCalled();
  });

  it("buys with the chosen amount and outcome, disabling controls while pending", async () => {
    const pending = deferred<BackgroundReply<WireEntry>>();
    const { send, button, text } = setup();
    send.mockReturnValue(pending.promise);
    button("amount-500").click();
    button("buy-no").click();
    button("buy-no").click();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: "buy", postId: matched.postId, instrumentSymbol: market.instrumentSymbol, outcome: "no", amountCents: 500,
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
    button("buy-yes").click();
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
    button("buy-yes").click();
    await vi.waitFor(() => { expect(root.textContent).toContain("Filled"); });
    expect(root.querySelector("a.link")).toBeNull();
  });

  it("shows guardrail refusals verbatim", async () => {
    const { send, button, root } = setup();
    const reason = "A $5 trade exceeds the $2 limit per trade.";
    send.mockResolvedValue(reply(entry({ kind: "refuse", spokenReason: reason, code: "over-per-trade-cap" })));
    button("buy-yes").click();
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="refused"]')).not.toBeNull(); });
    expect(root.querySelector(".result-detail")?.textContent).toBe(reason);
    expect(root.querySelector(".result-title")?.textContent).toBe("Refused");
  });

  it("asks for approval and confirms through the desk", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValueOnce(reply(entry({ kind: "needs-approval", spokenReason: "The $5 trade needs your approval.", intentId: "intent-9" })));
    button("buy-yes").click();
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="approval"]')).not.toBeNull(); });
    expect(root.textContent).toContain("The $5 trade needs your approval.");
    expect(button("buy-yes").disabled).toBe(true);
    send.mockResolvedValueOnce(reply(entry()));
    button("approve").click();
    expect(send).toHaveBeenLastCalledWith({ type: "confirm", intentId: "intent-9" });
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="filled"]')).not.toBeNull(); });
  });

  it("keeps the approval prompt and shows the error when confirming fails", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValueOnce(reply(entry({ kind: "needs-approval", intentId: "intent-9" })));
    button("buy-yes").click();
    await vi.waitFor(() => { expect(button("approve")).not.toBeNull(); });
    send.mockResolvedValueOnce({ ok: false, error: "Can't reach the desk. Is it running?" });
    button("approve").click();
    await vi.waitFor(() => { expect(root.textContent).toContain("Can't reach the desk. Is it running?"); });
    expect(button("approve").disabled).toBe(false);
  });

  it("shows desk errors quietly", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue({ ok: false, error: "The desk is not configured." });
    button("buy-yes").click();
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="quiet"]')).not.toBeNull(); });
    expect(root.textContent).toContain("The desk is not configured.");
  });

  it("disables trading and explains why for blocked markets", () => {
    const reason = "Sports markets are outside the desk's news-trading policy.";
    const { button, text, send } = setup({ ...matched, market: { ...market, category: "Sports", tradeable: false, tradeBlockedReason: reason } });
    expect(text()).toContain(reason);
    expect(button("buy-yes").disabled).toBe(true);
    button("buy-yes").click();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus on the same control across re-renders", () => {
    const { button, root } = setup();
    button("amount-200").focus();
    button("amount-200").click();
    expect(root.activeElement?.getAttribute("data-key")).toBe("amount-200");
  });
});
