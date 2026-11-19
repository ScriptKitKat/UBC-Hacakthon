import { beforeEach, describe, expect, it, vi } from "vitest";
import { friendlyEventTitle } from "./card-title";
import { CARD_MAX_WIDTH_PX } from "./card-styles";
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
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
});

describe("research link", () => {
  it("links to the research page in a new tab when a href is provided", () => {
    const handle = createCard(matched, vi.fn(), { researchHref: "http://localhost:3000/markets/GEMI-FED261211-MAINTAIN" });
    document.body.append(handle.host);
    const link = handle.host.shadowRoot?.querySelector<HTMLAnchorElement>('[data-key="research"]');
    expect(link?.getAttribute("href")).toBe("http://localhost:3000/markets/GEMI-FED261211-MAINTAIN");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.textContent).toBe("Research to understand more ↗");
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
    expect(root.querySelector(".contract-label")?.textContent).toBe("Fed maintains rate");
    expect(button("outcome-yes").textContent).toBe("Yes 62%");
    expect(button("outcome-no").textContent).toBe("No 40%");
    expect(button("outcome-yes").getAttribute("aria-pressed")).toBe("true");
    expect(text()).toContain("62% chance · 1.61 USDC potential payout");
    expect(text()).not.toContain("Implied by price");
    expect(text()).not.toContain("before fees");
    expect(text()).not.toContain("Your trade");
    expect(root.querySelector(".contract-picker .contract-chevron")).not.toBeNull();
    expect(button("trade").textContent).toBe("Trade now");
    expect(root.querySelector<HTMLAnchorElement>('[data-key="gemini"]')?.href).toBe(market.geminiUrl);
    expect(amountField(root).value).toBe("1.00");
    expect(amountField(root).getAttribute("aria-label")).toBe("Trade amount in USDC");
    expect(root.querySelector(".amount-unit")?.textContent).toBe("USDC");
    expect(root.querySelector(".amount-field")?.textContent).not.toContain("$");
  });

  it("stays compact with a blue Gemini-like theme and no green glow", () => {
    const { root, button, handle } = setup();
    const card = root.querySelector(".card");
    if (!card) throw new Error("missing card");
    const styles = getComputedStyle(card);
    expect(CARD_MAX_WIDTH_PX).toBe(360);
    expect(getComputedStyle(handle.host).width).toBe("360px");
    expect(card.getAttribute("data-theme")).toBe("light");
    expect(styles.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(styles.backgroundImage).not.toContain("gradient");
    expect(styles.borderColor).toBe("rgb(38, 221, 249)");
    expect(getComputedStyle(button("trade")).backgroundColor).toBe("rgb(26, 107, 255)");
    expect(getComputedStyle(button("trade")).boxShadow).toBe("none");
    expect(getComputedStyle(root.querySelector(".payout") as Element).color).toBe("rgb(26, 107, 255)");
    const withResearch = createCard(matched, vi.fn(), { researchHref: "http://localhost:3000/markets/GEMI-FED261211-MAINTAIN" });
    document.body.append(withResearch.host);
    const research = withResearch.host.shadowRoot?.querySelector(".research");
    if (!research) throw new Error("missing research link");
    expect(getComputedStyle(research).color).toBe("rgb(26, 107, 255)");
  });

  it("highlights the selected Yes outcome in green and No in red, leaving the other neutral", () => {
    const { root, button } = setup();
    const yes = button("outcome-yes");
    const no = button("outcome-no");
    expect(yes.classList.contains("is-selected")).toBe(true);
    expect(no.classList.contains("is-selected")).toBe(false);
    expect(getComputedStyle(yes).backgroundColor).toBe("rgb(209, 239, 219)");
    expect(getComputedStyle(yes).borderTopColor).toBe("rgb(17, 166, 66)");
    expect(getComputedStyle(yes).color).toBe("rgb(17, 166, 66)");
    expect(getComputedStyle(yes).boxShadow).toBe("none");
    expect(getComputedStyle(no).backgroundColor).toBe("transparent");
    expect(getComputedStyle(no).color).toBe("rgb(102, 112, 122)");
    press(no);
    const nextYes = button("outcome-yes");
    const nextNo = button("outcome-no");
    expect(nextYes.classList.contains("is-selected")).toBe(false);
    expect(nextNo.classList.contains("is-selected")).toBe(true);
    expect(getComputedStyle(nextNo).backgroundColor).toBe("rgb(250, 224, 224)");
    expect(getComputedStyle(nextNo).borderTopColor).toBe("rgb(196, 70, 70)");
    expect(getComputedStyle(nextNo).color).toBe("rgb(196, 70, 70)");
    expect(getComputedStyle(nextNo).boxShadow).toBe("none");
    expect(getComputedStyle(nextYes).backgroundColor).toBe("transparent");
    expect(getComputedStyle(nextYes).color).toBe("rgb(102, 112, 122)");
    expect(getComputedStyle(button("trade")).backgroundColor).toBe("rgb(26, 107, 255)");
    expect(getComputedStyle(root.querySelector(".payout") as Element).color).toBe("rgb(26, 107, 255)");
  });

  it("switches the card to the dark palette for X dim and lights-out backgrounds", () => {
    document.body.style.backgroundColor = "#000000";
    const lightsOut = setup();
    const lightsCard = lightsOut.root.querySelector(".card");
    if (!lightsCard) throw new Error("missing card");
    expect(lightsCard.getAttribute("data-theme")).toBe("dark");
    expect(getComputedStyle(lightsCard).backgroundColor).toBe("#101820");
    document.body.innerHTML = "";
    document.body.style.backgroundColor = "#15202B";
    const dim = setup();
    const dimCard = dim.root.querySelector(".card");
    if (!dimCard) throw new Error("missing card");
    expect(dimCard.getAttribute("data-theme")).toBe("dark");
    expect(getComputedStyle(dimCard).backgroundColor).toBe("#101820");
  });

  it("shows a Yes-price sparkline and a labeled change once history has enough points", () => {
    const { root, handle } = setup();
    expect(root.querySelector("path.line")).toBeNull();
    expect(root.querySelector(".change")).toBeNull();
    handle.update(quote);
    expect(root.querySelector("path.line")?.getAttribute("data-trend")).toBe("up");
    expect(root.querySelector("path.area")?.getAttribute("data-trend")).toBe("up");
    expect(getComputedStyle(root.querySelector("path.line") as Element).stroke).toBe("rgb(17, 166, 66)");
    expect(root.querySelector(".change")?.textContent).toBe("+8.3% 40s");
    expect(root.querySelector(".change")?.getAttribute("data-trend")).toBe("up");
    expect(root.querySelector(".chart svg")?.getAttribute("aria-label")).toBe("Yes price history");
  });

  it("hides the sparkline until history has three distinct prices, then follows the selected contract", async () => {
    const other = { ...market, instrumentSymbol: "GEMI-FED261211-CUT25", contractLabel: "Cut 25bps", yesCents: 20 };
    const falling = {
      ...quote,
      market: other,
      contracts: [market, other],
      history: [
        { at: "2026-11-18T22:00:00.000Z", yesCents: 40 },
        { at: "2026-11-19T10:00:00.000Z", yesCents: 28 },
        { at: "2026-11-19T22:00:00.000Z", yesCents: 20 },
      ],
    };
    const send = vi.fn().mockResolvedValue({ ok: true, value: falling });
    const handle = createCard({ ...matched, contracts: [market, other] }, send);
    document.body.append(handle.host);
    const root = handle.host.shadowRoot;
    if (!root) throw new Error("missing root");
    handle.update({ ...quote, contracts: [market, other], history: quote.history.slice(0, 2) });
    expect(root.querySelector("path.line")).toBeNull();
    handle.update({ ...quote, contracts: [market, other] });
    expect(root.querySelector("path.line")?.getAttribute("data-trend")).toBe("up");
    expect(root.querySelector(".change")?.textContent).toBe("+8.3% 40s");
    const trigger = root.querySelector<HTMLButtonElement>('[data-key="contract"]');
    if (!trigger) throw new Error("missing trigger");
    press(trigger);
    const option = root.querySelector<HTMLElement>(`[data-symbol="${other.instrumentSymbol}"]`);
    if (!option) throw new Error("missing option");
    press(option);
    expect(handle.symbol).toBe(other.instrumentSymbol);
    expect(root.querySelector("path.line")).toBeNull();
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "quote", symbol: other.instrumentSymbol }));
      expect(root.querySelector("path.line")?.getAttribute("data-trend")).toBe("down");
    });
    expect(root.querySelector(".change")?.textContent).toBe("−50% 24h");
    expect(getComputedStyle(root.querySelector("path.line") as Element).stroke).toBe("rgb(196, 70, 70)");
  });

  it("asks a friendly price question and keeps other Gemini titles", () => {
    const { root } = setup({
      ...matched,
      market: { ...market, eventTitle: "BTC price on November 19", expiryDate: "2026-11-19T22:00:00.000Z", contractLabel: "$61,750 or above" },
    });
    expect(root.querySelector(".title")?.textContent).toBe(friendlyEventTitle("BTC price on November 19", "2026-11-19T22:00:00.000Z"));
    expect(root.querySelector(".contract-label")?.textContent).toBe("$61,750 or above");
    expect(root.querySelector(".deadline")?.textContent).toContain("Closes Nov 19");
    const fed = setup();
    expect(fed.root.querySelector(".title")?.textContent).toBe("Fed decision in December?");
  });

  it("updates the chance and payout for the selected side, stake and live quote", () => {
    const { root, handle, button } = setup();
    press(button("outcome-no"));
    expect(root.textContent).toContain("40% chance · 2.50 USDC potential payout");
    editAmount(root, "5.00");
    expect(root.textContent).toContain("40% chance · 12.50 USDC potential payout");
    handle.update(quote);
    expect(root.textContent).toContain("37% chance · 13.51 USDC potential payout");
    expect(button("outcome-no").getAttribute("aria-pressed")).toBe("true");
    expect(amountField(root).value).toBe("5.00");
  });

  it("calculates the sketched payout from a custom USDC stake and live Gemini price", async () => {
    const { root, button, send, handle } = setup({ ...matched, market: { ...market, yesCents: 43 } });
    editAmount(root, "23.00");
    expect(root.querySelector(".payout")?.textContent).toBe("43% chance · 53.48 USDC potential payout");
    expect(send).not.toHaveBeenCalled();
    handle.update({ ...quote, market: { ...quote.market, yesCents: 50 } });
    expect(root.querySelector(".payout")?.textContent).toBe("50% chance · 46 USDC potential payout");
    send.mockResolvedValue({ ok: false, error: "stubbed" });
    press(button("trade"));
    await vi.waitFor(() => { expect(send).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 2300, seenPriceCents: 50 })); });
  });

  it.each(["", "0", "-1", "1.234", "1e3", "1000.01", "9999999999999999"])("does not submit an invalid USDC amount %j", (value) => {
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
    expect(root.textContent).toContain("62% chance · 3 USDC potential payout");
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
    const trigger = root.querySelector<HTMLButtonElement>('[data-key="contract"]');
    if (!trigger) throw new Error("missing contract trigger");
    press(trigger);
    const option = root.querySelector<HTMLElement>(`[data-symbol="${other.instrumentSymbol}"]`);
    if (!option) throw new Error("missing contract option");
    option.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(handle.symbol).toBe(market.instrumentSymbol);
    press(option);
    expect(handle.symbol).toBe(other.instrumentSymbol);
    expect(root.textContent).toContain("20% chance · 5 USDC potential payout");
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
    expect(button("contract").disabled).toBe(true);
    expect(root.querySelector(".contract-picker")?.getAttribute("data-disabled")).toBe("true");
    pending.resolve(reply(entry({ outcome: "no", notionalCents: 500 })));
    await vi.waitFor(() => { expect(text()).toContain("Simulated prediction"); });
    expect(button("trade").disabled).toBe(false);
  });

  it("distinguishes a simulated prediction from its actual USDC payment receipt", async () => {
    const { send, button, root } = setup();
    send.mockResolvedValue(reply(entry()));
    press(button("trade"));
    await vi.waitFor(() => { expect(root.querySelector('.result[data-tone="filled"]')).not.toBeNull(); });
    expect(root.querySelector(".result-title")?.textContent).toBe("Simulated prediction");
    expect(root.querySelector(".result-detail")?.textContent).toBe("1 USDC on Yes");
    expect(root.querySelector(".result-note")?.textContent).toBe("USDC payment on Solana");
    expect(root.querySelector(".result")?.textContent).not.toContain("ticket-1");
    const link = root.querySelector<HTMLAnchorElement>("a.link");
    expect(link?.textContent).toBe("View transaction ↗");
    expect(link?.href).toBe("https://explorer.solana.com/tx/sig?cluster=devnet");
    expect(link?.rel).toBe("noopener noreferrer");
  });

  it.each([
    { explorerUrl: "javascript:alert(1)" },
    { explorerUrl: "http://explorer.solana.com/tx/sig" },
    { explorerUrl: "https://evil.test/tx/sig" },
    { explorerUrl: "https://solscan.io/tx/sig" },
    { explorerUrl: "https://explorer.solana.com.evil.test/tx/sig" },
    { explorerUrl: undefined },
    { signature: undefined },
    { signature: " " },
  ])("does not invent a transaction link without a safe signed receipt: %j", async (receipt) => {
    const { send, button, root } = setup();
    send.mockResolvedValue(reply(entry(receipt)));
    press(button("trade"));
    await vi.waitFor(() => { expect(root.textContent).toContain("Simulated prediction"); });
    expect(root.querySelector("a.link")).toBeNull();
    expect(root.querySelector(".result-note")?.textContent).toBe("No transaction receipt");
  });

  it("does not expose test identifiers or pretend a simulated prediction is a fill", async () => {
    const { send, button, root } = setup();
    const result = entry({ signature: undefined, explorerUrl: undefined });
    send.mockResolvedValue(reply({ ...result, ticket: { ticketId: "QA-stub", symbol: market.instrumentSymbol, outcome: "yes", quantity: "1.61", price: "0.62", mode: "paper" } }));
    press(button("trade"));
    await vi.waitFor(() => { expect(root.querySelector(".result-title")?.textContent).toBe("Simulated prediction"); });
    const confirmation = root.querySelector(".result")?.textContent;
    expect(confirmation).not.toContain("QA-stub");
    expect(confirmation).not.toContain("Filled");
    expect(confirmation).not.toContain("$");
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

  it("keeps the contract trigger and listbox connected during price refreshes", () => {
    const { root, handle, button } = setup();
    const trigger = button("contract");
    trigger.focus();
    handle.update({ ...quote, market: { ...quote.market, yesCents: 50 } });
    expect(root.querySelector('[data-key="contract"]')).toBe(trigger);
    expect(trigger.isConnected).toBe(true);
    expect(root.activeElement).toBe(trigger);
    expect(root.querySelector(".payout")?.textContent).toBe("50% chance · 2 USDC potential payout");
    trigger.blur();
  });

  it("lists sibling contracts in a keyboard-accessible listbox and keeps the trigger", () => {
    const { root, handle, button } = setup();
    const trigger = button("contract");
    const other = { ...market, instrumentSymbol: "GEMI-FED261211-CUT25", contractLabel: "Cut 25bps", yesCents: 20 };
    handle.update({ ...quote, contracts: [market, other] });
    expect(root.querySelector('[data-key="contract"]')).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(root.querySelector('[role="listbox"]')?.hasAttribute("hidden")).toBe(true);
    press(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const options = Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options.map((option) => option.getAttribute("data-symbol"))).toEqual([market.instrumentSymbol, other.instrumentSymbol]);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[0]?.textContent).toContain(market.contractLabel);
    expect(options[0]?.textContent).toContain("62%");
    expect(options[1]?.textContent).toContain("Cut 25bps");
    expect(options[1]?.textContent).toContain("20%");
    press(options[1] as HTMLElement);
    expect(handle.symbol).toBe(other.instrumentSymbol);
    expect(root.querySelector(".contract-label")?.textContent).toBe(other.contractLabel);
    expect(button("contract").getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the contract listbox on Escape", () => {
    const { root, button } = setup({ ...matched, contracts: [market, { ...market, instrumentSymbol: "GEMI-FED261211-CUT25", contractLabel: "Cut 25bps" }] });
    press(button("contract"));
    expect(button("contract").getAttribute("aria-expanded")).toBe("true");
    const list = root.querySelector('[role="listbox"]');
    if (!list) throw new Error("missing listbox");
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(button("contract").getAttribute("aria-expanded")).toBe("false");
  });

  it("hides a Gemini link that is not on gemini.com", () => {
    const handle = createCard({ ...matched, market: { ...market, geminiUrl: "https://evil.test/predictions" } }, vi.fn());
    document.body.append(handle.host);
    const root = handle.host.shadowRoot;
    if (!root) throw new Error("missing root");
    expect(root.querySelector('[data-key="gemini"]')).toBeNull();
    expect(root.querySelector(".foot")?.textContent).toContain("Trade on Gemini");
  });
});

const deskBudget = { perTradeMaxCents: 1000, remainingCents: 1800, autoApproveMaxCents: 200 };

describe("card desk limits", () => {
  it("disables Trade now and explains when the stake exceeds the desk limit", () => {
    const handle = createCard(matched, vi.fn(), { budget: deskBudget });
    document.body.append(handle.host);
    const root = handle.host.shadowRoot;
    if (!root) throw new Error("missing root");
    const button = () => root.querySelector<HTMLButtonElement>('[data-key="trade"]') as HTMLButtonElement;
    editAmount(root, "10.01");
    expect(button().disabled).toBe(true);
    expect(root.textContent).toContain("Over your limit: max 10 USDC per trade (18 USDC left today)");
    expect(amountField(root).getAttribute("aria-invalid")).toBe("true");
    press(button());
    editAmount(root, "5.00");
    expect(button().disabled).toBe(false);
    expect(root.textContent).toContain("Needs approval");
    expect(root.textContent).not.toContain("Over your limit");
    editAmount(root, "1.00");
    expect(button().disabled).toBe(false);
    expect(root.textContent).not.toContain("Needs approval");
    expect(root.textContent).not.toContain("Over your limit");
  });

  it("does not present the API ceiling as a personal desk limit when budget is unknown", () => {
    const { root, button, send } = setup();
    editAmount(root, "23.00");
    expect(button("trade").disabled).toBe(false);
    expect(root.textContent).not.toContain("Over your limit");
    editAmount(root, "1000.01");
    expect(button("trade").disabled).toBe(true);
    expect(root.textContent).toContain("Maximum 1000 USDC per order.");
    expect(root.textContent).not.toContain("Over your limit");
    press(button("trade"));
    expect(send).not.toHaveBeenCalled();
  });

  it("applies a later budget update from the feed positions payload", () => {
    const handle = createCard(matched, vi.fn());
    document.body.append(handle.host);
    const root = handle.host.shadowRoot;
    if (!root) throw new Error("missing root");
    const button = () => root.querySelector<HTMLButtonElement>('[data-key="trade"]') as HTMLButtonElement;
    editAmount(root, "10.00");
    expect(button().disabled).toBe(false);
    handle.updateBudget(deskBudget);
    expect(button().disabled).toBe(false);
    handle.updateBudget({ ...deskBudget, remainingCents: 350 });
    expect(button().disabled).toBe(true);
    expect(root.textContent).toContain("Over your limit: max 10 USDC per trade (3.50 USDC left today)");
  });
});
