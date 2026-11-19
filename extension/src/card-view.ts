import { payoutFor } from "@/shared";
import { canBuy, cardReducer, initialCardState, isBusy } from "./card-state";
import type { CardAction } from "./card-state";
import { CARD_CSS } from "./card-styles";
import { h, svg } from "./dom";
import type { Child } from "./dom";
import { formatCents, formatDollars, formatPercent } from "./format";
import { AMOUNT_CHOICES_CENTS } from "./protocol";
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
    const { amountCents, market, outcome } = state;
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

  function tradeView(): Child {
    const { market, outcome } = state;
    const enabled = canBuy(state);
    const locked = isBusy(state) || state.status.phase === "needs-approval";
    const price = outcome === "yes" ? market.yesCents : market.noCents;
    const payout = payoutFor(price, state.amountCents, market.quantityLimits);
    const chips = AMOUNT_CHOICES_CENTS.map((cents) =>
      h("button", {
        className: "chip",
        text: formatDollars(cents),
        attributes: {
          type: "button",
          "data-key": `amount-${String(cents)}`,
          "aria-pressed": String(state.amountCents === cents),
          ...(locked ? { disabled: "" } : {}),
        },
        on: { click: userOnly(() => { dispatch({ type: "amount-selected", amountCents: cents }); }) },
      }),
    );
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
      h("div", { className: "stake" }, h("span", { text: "Your trade" }), h("div", { className: "chips", attributes: { role: "group", "aria-label": "Amount in dollars" } }, ...chips)),
      h("div", { className: "estimate", attributes: { "aria-live": "polite", "data-outcome": outcome } },
        h("div", { className: "payout", text: payout.kind === "quote" ? `${formatPercent(price)} chance | ${formatDollars(Math.floor(payout.payoutCents))} potential payout` : "Payout unavailable" }),
        h("div", { className: "estimate-note", text: payout.kind === "below-minimum" ? `Minimum ${String(payout.minimumContracts)} contracts` : `Implied by price · if ${outcome === "yes" ? "Yes" : "No"} wins · before fees` }),
      ),
      market.tradeable ? null : h("div", { className: "blocked", text: market.tradeBlockedReason ?? "Trading is unavailable for this market." }),
      h("button", { className: "buy", text: isBusy(state) ? "Placing order…" : "Trade now", attributes: {
        type: "button", "data-key": "trade", "aria-label": `Trade ${outcome} for ${formatDollars(state.amountCents)} at ${formatCents(price)}`,
        ...(enabled && payout.kind === "quote" ? {} : { disabled: "" }),
      }, on: { click: userOnly(() => void buy()) } }),
    );
  }

  function render(): void {
    const focusKey = shadow.activeElement?.getAttribute("data-key");
    const { market } = state;
    const locked = isBusy(state) || state.status.phase === "needs-approval";
    const select = h("select", { className: "contract", attributes: { "aria-label": "Prediction contract", "data-key": "contract", ...(locked ? { disabled: "" } : {}) } },
      ...state.contracts.map((contract) => h("option", { text: contract.contractLabel, attributes: { value: contract.instrumentSymbol, ...(market.instrumentSymbol === contract.instrumentSymbol ? { selected: "" } : {}) } })),
    );
    select.addEventListener("change", userOnly(() => { dispatch({ type: "contract-selected", symbol: select.value }); }));
    const researchHref = options.researchHrefFor?.(market.instrumentSymbol) ?? options.researchHref;
    const closes = deadline(market.expiryDate);
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
          h("div", { className: "title", text: market.eventTitle, attributes: { title: market.description ?? market.eventTitle } }),
          select,
          closes === null ? null : h("div", { className: "deadline", text: closes }),
        ),
      ),
      tradeView(),
      h("div", { className: "status", attributes: { "aria-live": "polite" } }, resultView()),
    );
    const card = h(
      "div",
      { className: "card", attributes: { role: "group", "aria-label": `Prediction market: ${market.eventTitle}` } },
      body,
      h(
        "div",
        { className: "foot" },
        "Trade on ",
        market.geminiUrl !== undefined && isSafeLink(market.geminiUrl)
          ? h("a", { className: "gemini", text: "Gemini", attributes: { href: market.geminiUrl, target: "_blank", rel: "noopener noreferrer", "data-key": "gemini" } })
          : h("strong", { text: "Gemini" }),
        researchHref === undefined
          ? null
          : h("span", {}, " | ", h("a", { className: "research", text: "Research", attributes: { href: researchHref, target: "_blank", rel: "noopener noreferrer", "data-key": "research" } }), " to understand more"),
      ),
    );
    root.replaceChildren(card);
    if (focusKey) shadow.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  }

  render();

  return {
    host,
    postId: initial.postId,
    get symbol() { return state.market.instrumentSymbol; },
    update: (quote) => { dispatch({ type: "quote-received", quote }); },
  };
}
