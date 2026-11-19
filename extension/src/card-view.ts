import { MAX_FEED_BUY_CENTS, parseDollarsToCents, payoutFor } from "@/shared";
import { canBuy, cardReducer, initialCardState, isBusy } from "./card-state";
import type { CardAction } from "./card-state";
import { ensureCardFont } from "./card-font";
import { CARD_CSS } from "./card-styles";
import { h, svg } from "./dom";
import type { Child } from "./dom";
import { formatCents, formatDollars, formatPercent } from "./format";
import type { Sender } from "./protocol";
import type { WireEntry, WireMatched, WireQuote } from "./wire";

export const CARD_HOST_ATTRIBUTE = "data-ntd-card";
const BUBBLING_EVENTS = ["click", "change", "input", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "touchstart", "touchend"];

export interface CardHandle {
  readonly host: HTMLElement;
  readonly postId: string;
  readonly symbol: string;
  readonly update: (quote: WireQuote) => void;
}

function gemIcon(): SVGElement {
  const gem = svg("svg", { attributes: { viewBox: "0 0 24 24", "aria-hidden": "true" } });
  gem.append(
    svg("path", { attributes: { d: "M12 2.5 21 9l-9 12.5L3 9z", fill: "rgba(255,255,255,0.95)" } }),
    svg("path", { attributes: { d: "M3 9h18M12 2.5 8.5 9 12 21.5 15.5 9z", fill: "none", stroke: "#1a6bff", "stroke-width": "1.2", "stroke-linejoin": "round" } }),
  );
  return gem;
}

function userOnly(handler: () => void): (event: Event) => void {
  return (event) => {
    if (event.isTrusted) handler();
  };
}

function entrySummary(entry: WireEntry): string {
  const ticket = entry.ticket;
  const amount = `${formatDollars(entry.notionalCents)} ${entry.outcome.toUpperCase()}`;
  return ticket ? `${amount} · ${ticket.quantity} @ ${ticket.price} · paper ticket ${ticket.ticketId.slice(0, 8)}` : amount;
}

function isSafeLink(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function deadline(expiry: string | null | undefined): string | null {
  if (!expiry) return null;
  const date = new Date(expiry);
  if (!Number.isFinite(date.getTime())) return null;
  return `Closes ${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date)}`;
}

export interface CardOptions {
  readonly researchHref?: string;
  readonly researchHrefFor?: (symbol: string) => string | undefined;
}

export function createCard(initial: WireMatched, send: Sender, options: CardOptions = {}): CardHandle {
  ensureCardFont(document);
  let state = initialCardState(initial);
  const host = h("div", { attributes: { [CARD_HOST_ATTRIBUTE]: initial.postId } });
  const shadow = host.attachShadow({ mode: "open" });
  const root = h("div");
  shadow.append(h("style", { text: CARD_CSS }), root);
  for (const type of BUBBLING_EVENTS) host.addEventListener(type, (event) => { event.stopPropagation(); });

  function dispatch(action: CardAction): void {
    state = cardReducer(state, action);
    render();
  }

  async function buy(): Promise<void> {
    if (!canBuy(state)) return;
    const { market, outcome } = state;
    const amountCents = parseDollarsToCents(state.amountText);
    if (amountCents === undefined) return;
    const seenPriceCents = outcome === "yes" ? market.yesCents : market.noCents;
    dispatch({ type: "buy-started" });
    const reply = await send({
      type: "buy",
      postId: state.match.postId,
      instrumentSymbol: market.instrumentSymbol,
      outcome,
      amountCents,
      clientOrderId: crypto.randomUUID(),
      ...(seenPriceCents === null ? {} : { seenPriceCents: Math.round(seenPriceCents) }),
    });
    dispatch(reply.ok ? { type: "buy-settled", entry: reply.value } : { type: "buy-failed", message: reply.error });
  }

  async function approve(): Promise<void> {
    if (state.status.phase !== "needs-approval") return;
    const { intentId } = state.status.entry;
    dispatch({ type: "approve-started" });
    const reply = await send({ type: "confirm", intentId });
    dispatch(reply.ok ? { type: "approve-settled", entry: reply.value } : { type: "approve-failed", message: reply.error });
  }

  function resultView(): Child {
    const { status } = state;
    switch (status.phase) {
      case "idle":
        return null;
      case "buying":
        return h("div", { className: "result", attributes: { "data-tone": "pending" } }, h("span", { className: "result-title", text: "Placing order…" }));
      case "filled": {
        const { explorerUrl } = status.entry;
        return h(
          "div",
          { className: "result", attributes: { "data-tone": "filled" } },
          h("span", { className: "result-title", text: "Filled" }),
          h("span", { className: "result-detail", text: entrySummary(status.entry) }),
          explorerUrl !== undefined && isSafeLink(explorerUrl)
            ? h("a", { className: "link", text: "View on Solana Explorer ↗", attributes: { href: explorerUrl, target: "_blank", rel: "noopener noreferrer" } })
            : null,
        );
      }
      case "needs-approval":
      case "approving": {
        const approving = status.phase === "approving";
        return h(
          "div",
          { className: "result", attributes: { "data-tone": "approval" } },
          h("span", { className: "result-title", text: "Needs approval" }),
          h("span", { className: "result-detail", text: status.entry.spokenReason }),
          status.phase === "needs-approval" && status.approvalError !== null ? h("span", { text: status.approvalError }) : null,
          h("button", {
            className: "approve",
            text: approving ? "Approving…" : "Approve",
            attributes: { type: "button", "data-key": "approve", ...(approving ? { disabled: "" } : {}) },
            on: { click: userOnly(() => void approve()) },
          }),
        );
      }
      case "refused":
        return h(
          "div",
          { className: "result", attributes: { "data-tone": "refused" } },
          h("span", { className: "result-title", text: status.entry.kind === "refuse" ? "Refused" : "Not placed" }),
          h("span", { className: "result-detail", text: status.entry.spokenReason }),
        );
      case "error":
        return h("div", { className: "result", attributes: { "data-tone": "quiet" } }, h("span", { text: status.message }));
      default: {
        const exhaustive: never = status;
        return exhaustive;
      }
    }
  }

  function tradeView(): HTMLDivElement {
    const { market, outcome } = state;
    const enabled = canBuy(state);
    const locked = isBusy(state) || state.status.phase === "needs-approval";
    const price = outcome === "yes" ? market.yesCents : market.noCents;
    const amountCents = parseDollarsToCents(state.amountText);
    const amountError = amountCents === undefined || amountCents <= 0 ? "Enter a dollar amount above $0 with up to two decimal places."
      : amountCents > MAX_FEED_BUY_CENTS ? `Maximum ${formatDollars(MAX_FEED_BUY_CENTS)} per order.` : null;
    const payout = payoutFor(price, amountError === null ? amountCents ?? 0 : 0, market.quantityLimits);
    const amount = h("input", { className: "amount-input", attributes: {
      type: "text", inputmode: "decimal", "aria-label": "Trade amount in dollars", "data-key": "amount",
      value: state.amountText, placeholder: "0.00", maxlength: "16", autocomplete: "off", spellcheck: "false",
      "aria-invalid": String(amountError !== null), ...(locked ? { disabled: "" } : {}),
    } });
    amount.addEventListener("input", userOnly(() => { dispatch({ type: "amount-edited", amountText: amount.value }); }));
    const outcomeButton = (side: "yes" | "no", cents: number | null) =>
      h("button", {
        className: "outcome",
        text: `${side === "yes" ? "Yes" : "No"} ${formatPercent(cents)}`,
        attributes: {
          type: "button",
          "data-outcome": side,
          "data-key": `outcome-${side}`,
          "aria-pressed": String(outcome === side),
          ...(locked ? { disabled: "" } : {}),
        },
        on: { click: userOnly(() => { dispatch({ type: "outcome-selected", outcome: side }); }) },
      });
    return h(
      "div",
      { className: "trade" },
      h("div", { className: "outcomes", attributes: { role: "group", "aria-label": "Prediction outcome" } }, outcomeButton("yes", market.yesCents), outcomeButton("no", market.noCents)),
      h("label", { className: "amount-field" }, h("span", { className: "amount-label", text: "Dollars" }), h("span", { className: "amount-value" }, h("span", { text: "$", attributes: { "aria-hidden": "true" } }), h("span", { className: "amount-editor" }, h("span", { className: "amount-mirror", text: state.amountText || "0.00", attributes: { "aria-hidden": "true" } }), amount))),
      amountError === null ? null : h("div", { className: "amount-error", text: amountError, attributes: { role: "status" } }),
      h("div", { className: "estimate", attributes: { "aria-live": "polite", "data-outcome": outcome } },
        h("div", { className: "payout", text: payout.kind === "quote" ? `${formatPercent(price)} chance | ${formatDollars(Math.floor(payout.payoutCents))} potential payout` : "Payout unavailable" }),
        payout.kind === "below-minimum" ? h("div", { className: "estimate-note", text: `Minimum ${String(payout.minimumContracts)} contracts` }) : null,
      ),
      market.tradeable ? null : h("div", { className: "blocked", text: market.tradeBlockedReason ?? "Trading is unavailable for this market." }),
      h("button", { className: "buy", text: isBusy(state) ? "Placing order…" : "Trade now", attributes: {
        type: "button", "data-key": "trade", "aria-label": `Trade ${outcome} for ${formatDollars(amountCents ?? 0)} at ${formatCents(price)}`,
        ...(enabled ? {} : { disabled: "" }),
      }, on: { click: userOnly(() => void buy()) } }),
    );
  }

  const select = h("select", { className: "contract", attributes: { "aria-label": "Prediction contract", "data-key": "contract" } });
  select.addEventListener("change", userOnly(() => { dispatch({ type: "contract-selected", symbol: select.value }); }));
  const eventTitle = h("div", { className: "title" });
  const contractLabel = h("span", { className: "contract-label", attributes: { "aria-hidden": "true" } });
  const picker = h("span", { className: "contract-picker" }, contractLabel, svg("svg", { className: "contract-chevron", attributes: { viewBox: "0 0 24 24", "aria-hidden": "true" } }, svg("path", { attributes: { d: "m6 9 6 6 6-6", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" } })), select);
  const expiry = h("div", { className: "deadline" });
  const status = h("div", { className: "status", attributes: { "aria-live": "polite" } });
  const foot = h("div", { className: "foot" });
  let trade = h("div");
  const body = h(
    "div",
    { className: "body" },
    h(
      "div",
      { className: "head" },
      h("div", { className: "icon" }, gemIcon()),
      h(
        "div",
        { className: "titles" },
        eventTitle,
        picker,
        expiry,
      ),
    ),
    trade,
    status,
  );
  const card = h("div", { className: "card", attributes: { role: "group" } }, body, foot);
  root.append(card);

  function render(): void {
    const focused = shadow.activeElement;
    const focusKey = focused?.getAttribute("data-key");
    const selection = focused instanceof HTMLInputElement ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : undefined;
    const { market, contracts } = state;
    const locked = isBusy(state) || state.status.phase === "needs-approval";
    const existing = Array.from(select.options);
    if (existing.length !== contracts.length || contracts.some((contract, index) => existing[index]?.value !== contract.instrumentSymbol || existing[index].textContent !== contract.contractLabel)) {
      select.replaceChildren(...contracts.map((contract) => h("option", { text: contract.contractLabel, attributes: { value: contract.instrumentSymbol } })));
    }
    if (select.value !== market.instrumentSymbol) select.value = market.instrumentSymbol;
    if (select.disabled !== locked) select.disabled = locked;
    picker.setAttribute("data-disabled", String(locked));
    eventTitle.textContent = market.eventTitle;
    eventTitle.title = market.description ?? market.eventTitle;
    contractLabel.textContent = market.contractLabel;
    const closes = deadline(market.expiryDate);
    expiry.hidden = closes === null;
    expiry.textContent = closes;
    card.setAttribute("aria-label", `Prediction market: ${market.eventTitle}`);
    const nextTrade = tradeView();
    trade.replaceWith(nextTrade);
    trade = nextTrade;
    const result = resultView();
    status.replaceChildren(...(result === null ? [] : [result]));
    const researchHref = options.researchHrefFor?.(market.instrumentSymbol) ?? options.researchHref;
    foot.replaceChildren(...[
        "Trade on ",
        market.geminiUrl !== undefined && isSafeLink(market.geminiUrl)
          ? h("a", { className: "gemini", text: "Gemini", attributes: { href: market.geminiUrl, target: "_blank", rel: "noopener noreferrer", "data-key": "gemini" } })
          : h("strong", { text: "Gemini" }),
        researchHref === undefined
          ? null
          : h("span", {}, " | ", h("a", { className: "research", text: "Research", attributes: { href: researchHref, target: "_blank", rel: "noopener noreferrer", "data-key": "research" } }), " to understand more"),
    ].filter((child) => child !== null));
    if (focusKey) {
      const next = shadow.querySelector<HTMLElement>(`[data-key="${focusKey}"]`);
      if (next !== shadow.activeElement) next?.focus();
      if (next instanceof HTMLInputElement && selection) next.setSelectionRange(selection.start, selection.end, selection.direction ?? undefined);
    }
  }

  render();

  return {
    host,
    postId: initial.postId,
    get symbol() { return state.market.instrumentSymbol; },
    update: (quote) => { dispatch({ type: "quote-received", quote }); },
  };
}
