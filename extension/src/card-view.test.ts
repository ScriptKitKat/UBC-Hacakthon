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

function amountField(root: ShadowRoot): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>('[data-key="amount"]');
  if (!input) throw new Error("missing amount field");
  return input;
}

function editAmount(root: ShadowRoot, value: string): void {
  const input = amountField(root);
  input.value = value;
  input.dispatchEvent(trusted(new Event("input", { bubbles: true, composed: true })));
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
    expect(link?.textContent).toBe("Research");
  });

  it("omits the link without a href", () => {
    const handle = createCard(matched, vi.fn());
    expect(handle.host.shadowRoot?.querySelector('[data-key="research"]')).toBeNull();
  });
});

describe("market card", () => {
  it("shows the Gemini expiry in Central Time without inventing a deadline", () => {
    const { root } = setup({ ...matched, market: { ...market, expiryDate: "2026-11-19T22:00:00.000Z" } });
    expect(root.querySelector(".deadline")?.textContent).toContain("Nov 19, 4:00 PM CST");
  });

  it("renders the sketch layout with the Gemini title, outcome pill, payout and footer", () => {
    const { text, handle, root, button } = setup();
    expect(handle.host.getAttribute(CARD_HOST_ATTRIBUTE)).toBe(matched.postId);
    expect(root.querySelector(".title")?.textContent).toBe("Fed decision in December?");
    expect(root.querySelector("select")?.textContent).toBe("Fed maintains rate");
    expect(button("outcome-yes").textContent).toBe("Yes 62%");
    expect(button("outcome-no").textContent).toBe("No 40%");
    expect(button("outcome-yes").getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("62% chance | $1.61 potential payout");
    expect(text()).not.toContain("Implied by price");
    expect(text()).not.toContain("before fees");
    expect(text()).not.toContain("Your trade");
    expect(root.querySelector(".contract-picker .contract-chevron")).not.toBeNull();
    expect(button("trade").textContent).toBe("Trade now");
    expect(root.querySelector<HTMLAnchorElement>('[data-key="gemini"]')?.href).toBe(market.geminiUrl);
    expect(amountField(root).value).toBe("1.00");
  });

  it("updates the chance and payout for the selected side, stake and live quote", () => {
    const { root, handle, button } = setup();
    press(button("outcome-no"));
    expect(root.textContent).toContain("40% chance | $2.50 potential payout");
    editAmount(root, "5.00");
    expect(root.textContent).toContain("40% chance | $12.50 potential payout");
    handle.update(quote);
    expect(root.textContent).toContain("37% chance | $13.51 potential payout");
    expect(button("outcome-no").getAttribute("aria-pressed")).toBe("true");
    expect(amountField(root).value).toBe("5.00");
  });

  it("calculates the sketched payout from a custom dollar stake and live Gemini price", async () => {
    const { root, button, send, handle } = setup({ ...matched, market: { ...market, yesCents: 43 } });
    editAmount(root, "23.00");
    expect(root.querySelector(".payout")?.textContent).toBe("43% chance | $53.48 potential payout");
    expect(send).not.toHaveBeenCalled();
    handle.update({ ...quote, market: { ...quote.market, yesCents: 50 } });
    expect(root.querySelector(".payout")?.textContent).toBe("50% chance | $46 potential payout");
    send.mockResolvedValue({ ok: false, error: "stubbed" });
    press(button("trade"));
    await vi.waitFor(() => { expect(send).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 2300, seenPriceCents: 50 })); });
  });

  it.each(["", "0", "-1", "1.234", "1e3", "1000.01", "9999999999999999"])("does not submit an invalid dollar amount %j", (value) => {
    const { root, button, send } = setup();
    editAmount(root, value);
    expect(button("trade").disabled).toBe(true);
    expect(amountField(root).getAttribute("aria-invalid")).toBe("true");
    press(button("trade"));
    expect(send).not.toHaveBeenCalled();
    editAmount(root, "2.50");
    expect(button("trade").disabled).toBe(false);
    expect(amountField(root).getAttribute("aria-invalid")).toBe("false");
  });

  it("uses Gemini quantity limits and disables trades below the minimum", () => {
    const { root, button } = setup({ ...matched, market: { ...market, quantityLimits: { quantityIncrementHundredths: 100, quantityMinimumHundredths: 200 } } });
    expect(root.textContent).toContain("Minimum 2 contracts");
    expect(button("trade").disabled).toBe(true);
    editAmount(root, "2.00");
    expect(root.textContent).toContain("62% chance | $3 potential payout");
    expect(button("trade").disabled).toBe(false);
  });

  it("does not invent a chance or payout when a quote is missing", () => {
    const { root, button } = setup({ ...matched, market: { ...market, yesCents: null } });
    expect(button("outcome-yes").textContent).toBe("Yes —");
    expect(root.textContent).toContain("Payout unavailable");
    expect(button("trade").disabled).toBe(true);
  });

  it("switches contracts, research links, polling symbol and the submitted order together", async () => {
    const other = { ...market, instrumentSymbol: "GEMI-FED261211-CUT25", contractLabel: "Cut 25bps", yesCents: 20 };
    const send = vi.fn().mockResolvedValue({ ok: false, error: "test refusal" });
    const handle = createCard({ ...matched, contracts: [market, other] }, send, { researchHrefFor: (symbol) => `https://desk.test/markets/${symbol}` });
    const root = handle.host.shadowRoot;
    if (!root) throw new Error("missing root");
    document.body.append(handle.host);
    const select = root.querySelector("select");
    if (!select) throw new Error("missing contract selector");
    select.value = other.instrumentSymbol;
    select.dispatchEvent(new Event("change"));
    expect(handle.symbol).toBe(market.instrumentSymbol);
    select.dispatchEvent(trusted(new Event("change")));
    expect(handle.symbol).toBe(other.instrumentSymbol);
    expect(root.textContent).toContain("20% chance | $5 potential payout");
    expect(root.querySelector<HTMLAnchorElement>('[data-key="research"]')?.href).toBe(`https://desk.test/markets/${other.instrumentSymbol}`);
    handle.update(quote);
    expect(handle.symbol).toBe(other.instrumentSymbol);
    press(root.querySelector('[data-key="trade"]') as HTMLElement);
    await vi.waitFor(() => { expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "buy", instrumentSymbol: other.instrumentSymbol, seenPriceCents: 20 })); });
  });

  it("gives each buy click a fresh client order id", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue({ ok: false, error: "no" });
    press(button("trade"));
    await vi.waitFor(() => { expect(root.textContent).toContain("no"); });
    press(button("trade"));
    await vi.waitFor(() => { expect(send).toHaveBeenCalledTimes(2); });
    const ids = send.mock.calls.map(([request]) => (request as { clientOrderId: string }).clientOrderId);
    expect(new Set(ids).size).toBe(2);
  });

  it("ignores events that did not come from the user", () => {
    const { send, button, root } = setup();
    amountField(root).value = "5";
    amountField(root).dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    button("trade").click();
    button("trade").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    press(button("outcome-yes"));
    expect(amountField(root).value).toBe("1.00");
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores synthetic approvals", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValueOnce(reply(entry({ kind: "needs-approval", intentId: "intent-9" })));
    press(button("trade"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="approval"]')).not.toBeNull(); });
    button("approve").click();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops pointer and keyboard events from reaching the tweet", () => {
    const { root } = setup();
    const outside = vi.fn();
    document.body.addEventListener("click", outside);
    document.body.addEventListener("keydown", outside);
    editAmount(root, "2.00");
    amountField(root).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(outside).not.toHaveBeenCalled();
  });

  it("buys with the chosen amount and outcome, disabling controls while pending", async () => {
    const pending = deferred<BackgroundReply<WireEntry>>();
    const { send, button, text, root } = setup();
    send.mockReturnValue(pending.promise);
    editAmount(root, "5.00");
    press(button("outcome-no"));
    press(button("trade"));
    press(button("trade"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      type: "buy", postId: matched.postId, instrumentSymbol: market.instrumentSymbol, outcome: "no", amountCents: 500,
      clientOrderId: expect.stringMatching(UUID) as string, seenPriceCents: 40,
    });
    expect(text()).toContain("Placing order…");
    expect(button("trade").disabled).toBe(true);
    expect(amountField(root).disabled).toBe(true);
    expect(root.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(root.querySelector(".contract-picker")?.getAttribute("data-disabled")).toBe("true");
    const select = root.querySelector("select");
    if (!select) throw new Error("missing contract selector");
    expect(getComputedStyle(select).opacity).toBe("0");
    pending.resolve(reply(entry({ outcome: "no", notionalCents: 500 })));
    await vi.waitFor(() => { expect(text()).toContain("Filled"); });
    expect(button("trade").disabled).toBe(false);
  });

  it("shows the fill with the ticket and an explorer link", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue(reply(entry()));
    press(button("trade"));
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
    press(button("trade"));
    await vi.waitFor(() => { expect(root.textContent).toContain("Filled"); });
    expect(root.querySelector("a.link")).toBeNull();
  });

  it("shows guardrail refusals verbatim", async () => {
    const { send, button, root } = setup();
    const reason = "A $5 trade exceeds the $2 limit per trade.";
    send.mockResolvedValue(reply(entry({ kind: "refuse", spokenReason: reason, code: "over-per-trade-cap" })));
    press(button("trade"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="refused"]')).not.toBeNull(); });
    expect(root.querySelector(".result-detail")?.textContent).toBe(reason);
    expect(root.querySelector(".result-title")?.textContent).toBe("Refused");
  });

  it("asks for approval and confirms through the desk", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValueOnce(reply(entry({ kind: "needs-approval", spokenReason: "The $5 trade needs your approval.", intentId: "intent-9" })));
    press(button("trade"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="approval"]')).not.toBeNull(); });
    expect(root.textContent).toContain("The $5 trade needs your approval.");
    expect(button("trade").disabled).toBe(true);
    send.mockResolvedValueOnce(reply(entry()));
    expect(amountField(root).disabled).toBe(true);
    editAmount(root, "23.00");
    expect(amountField(root).value).toBe("1.00");
    press(button("approve"));
    expect(send).toHaveBeenLastCalledWith({ type: "confirm", intentId: "intent-9" });
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="filled"]')).not.toBeNull(); });
  });

  it("keeps the approval prompt and shows the error when confirming fails", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValueOnce(reply(entry({ kind: "needs-approval", intentId: "intent-9" })));
    press(button("trade"));
    await vi.waitFor(() => { expect(button("approve")).not.toBeNull(); });
    send.mockResolvedValueOnce({ ok: false, error: "Can't reach the desk. Is it running?" });
    press(button("approve"));
    await vi.waitFor(() => { expect(root.textContent).toContain("Can't reach the desk. Is it running?"); });
    expect(button("approve").disabled).toBe(false);
  });

  it("shows desk errors quietly", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue({ ok: false, error: "The desk is not configured." });
    press(button("trade"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="quiet"]')).not.toBeNull(); });
    expect(root.textContent).toContain("The desk is not configured.");
  });

  it("disables trading and explains why for blocked markets", () => {
    const reason = "Sports markets are outside the desk's news-trading policy.";
    const { button, text, send } = setup({ ...matched, market: { ...market, category: "Sports", tradeable: false, tradeBlockedReason: reason } });
    expect(text()).toContain(reason);
    expect(button("trade").disabled).toBe(true);
    press(button("trade"));
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus on the same control across re-renders", () => {
    const { root, handle } = setup();
    editAmount(root, "23.00");
    amountField(root).focus();
    amountField(root).setSelectionRange(2, 2);
    handle.update(quote);
    expect(root.activeElement?.getAttribute("data-key")).toBe("amount");
    expect(amountField(root).selectionStart).toBe(2);
    expect(amountField(root).value).toBe("23.00");
  });

  it("keeps the native contract selector and options connected during price refreshes", () => {
    const { root, handle } = setup();
    const select = root.querySelector("select");
    if (!select) throw new Error("missing contract selector");
    const firstOption = select.options[0];
    select.focus();
    handle.update({ ...quote, market: { ...quote.market, yesCents: 50 } });
    expect(root.querySelector("select")).toBe(select);
    expect(select.options[0]).toBe(firstOption);
    expect(select.isConnected).toBe(true);
    expect(root.activeElement).toBe(select);
    expect(root.querySelector(".payout")?.textContent).toBe("50% chance | $2 potential payout");
    select.blur();
  });

  it("refreshes listed contract options without replacing the selector", () => {
    const { root, handle } = setup();
    const select = root.querySelector("select");
    if (!select) throw new Error("missing contract selector");
    const other = { ...market, instrumentSymbol: "GEMI-FED261211-CUT25", contractLabel: "Cut 25bps", yesCents: 20 };
    handle.update({ ...quote, contracts: [market, other] });
    expect(root.querySelector("select")).toBe(select);
    expect(Array.from(select.options).map((option) => option.value)).toEqual([market.instrumentSymbol, other.instrumentSymbol]);
    expect(select.value).toBe(market.instrumentSymbol);
    select.value = other.instrumentSymbol;
    select.dispatchEvent(trusted(new Event("change")));
    expect(handle.symbol).toBe(other.instrumentSymbol);
    expect(root.querySelector(".contract-label")?.textContent).toBe(other.contractLabel);
  });
});
