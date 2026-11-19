import { canBuy, cardReducer, initialCardState, isBusy } from "./card-state";
import type { CardAction, CardState } from "./card-state";
import { CARD_CSS } from "./card-styles";
import { h, svg } from "./dom";
import type { Child } from "./dom";
import { clampPercent, formatCents, formatChangePercent, formatDollars, formatPercent } from "./format";
import { AMOUNT_CHOICES_CENTS } from "./protocol";
import type { Sender } from "./protocol";
import { buildSparkline } from "./sparkline";
import type { Trend } from "./sparkline";
import type { WireEntry, WireMatched, WireQuote } from "./wire";

export const CARD_HOST_ATTRIBUTE = "data-ntd-card";
const CHART_WIDTH = 112;
const CHART_HEIGHT = 40;
const BUBBLING_EVENTS = ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "touchstart", "touchend"];

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

function trendOf(state: CardState): Trend {
  const first = state.history[0]?.yesCents;
  const last = state.history.at(-1)?.yesCents;
  if (first === undefined || last === undefined || last === first) return "flat";
  return last > first ? "up" : "down";
}

function chartView(state: CardState): Child {
  const sparkline = buildSparkline(state.history.map((point) => point.yesCents), CHART_WIDTH, CHART_HEIGHT);
  if (sparkline) {
    const chart = svg("svg", { attributes: { viewBox: `0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`, role: "img", "aria-label": "Yes price history" } });
    chart.append(
      svg("path", { className: "area", attributes: { d: sparkline.area, "data-trend": sparkline.trend } }),
      svg("path", { className: "line", attributes: { d: sparkline.line, "data-trend": sparkline.trend } }),
    );
    return chart;
  }
  const yes = clampPercent(state.market.impliedYesPercent ?? state.market.yesCents);
  const yesFill = h("div", { className: "bar-yes", attributes: { style: `width:${String(yes)}%` } });
  return h(
    "div",
    { className: "bar", attributes: { role: "img", "aria-label": `Yes ${formatPercent(yes)}, No ${formatPercent(100 - yes)}` } },
    h("div", { className: "bar-track" }, yesFill, h("div", { className: "bar-no" })),
    h("div", { className: "bar-labels" }, h("span", { text: `Yes ${formatPercent(yes)}` }), h("span", { text: `No ${formatPercent(100 - yes)}` })),
  );
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

export interface CardOptions {
  readonly researchHref?: string;
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

  async function buy(outcome: "yes" | "no"): Promise<void> {
    if (!canBuy(state)) return;
    const { amountCents, market } = state;
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
    const { market } = state;
    const enabled = canBuy(state);
    const chips = AMOUNT_CHOICES_CENTS.map((cents) =>
      h("button", {
        className: "chip",
        text: formatDollars(cents),
        attributes: {
          type: "button",
          "data-key": `amount-${String(cents)}`,
          "aria-pressed": String(state.amountCents === cents),
          ...(isBusy(state) ? { disabled: "" } : {}),
        },
        on: { click: userOnly(() => { dispatch({ type: "amount-selected", amountCents: cents }); }) },
      }),
    );
    const buyButton = (outcome: "yes" | "no", price: number | null) =>
      h("button", {
        className: "buy",
        text: `Buy ${outcome === "yes" ? "Yes" : "No"} ${formatCents(price)}`,
        attributes: {
          type: "button",
          "data-outcome": outcome,
          "data-key": `buy-${outcome}`,
          "aria-label": `Buy ${outcome} for ${formatDollars(state.amountCents)} at ${formatCents(price)}`,
          ...(enabled ? {} : { disabled: "" }),
        },
        on: { click: userOnly(() => void buy(outcome)) },
      });
    return h(
      "div",
      { className: "trade" },
      market.tradeable ? null : h("div", { className: "blocked", text: market.tradeBlockedReason ?? "Trading is unavailable for this market." }),
      h("div", { className: "chips", attributes: { role: "group", "aria-label": "Amount in dollars" } }, ...chips),
      h("div", { className: "buys" }, buyButton("yes", market.yesCents), buyButton("no", market.noCents)),
    );
  }

  function render(): void {
    const focusKey = shadow.activeElement?.getAttribute("data-key");
    const { market, match } = state;
    const trend = trendOf(state);
    const first = state.history[0]?.yesCents;
    const last = state.history.at(-1)?.yesCents;
    const change = first !== undefined && last !== undefined && state.history.length > 1 ? formatChangePercent(first, last) : null;
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
          h("div", { className: "title", text: market.eventTitle, attributes: { title: market.eventTitle } }),
          h("div", { className: "sub", text: `${market.contractLabel} · ${market.category}` }),
          h(
            "div",
            { className: "price-row" },
            h("span", { className: "price-label", text: "YES " }),
            h("span", { className: "price", text: formatCents(market.yesCents) }),
            change === null ? null : h("span", { className: "change", text: change, attributes: { "data-trend": trend } }),
            h("span", { className: "no-price", text: `NO ${formatCents(market.noCents)}` }),
          ),
        ),
        h("div", { className: "chart" }, chartView(state)),
      ),
      h(
        "div",
        { className: "why" },
        h("span", { className: "badge", text: match.matchedBy === "grok" ? "Grok" : "matched by keywords", attributes: { "data-source": match.matchedBy } }),
        h("span", { className: "why-text", text: match.why }),
      ),
      tradeView(),
      h("div", { attributes: { "aria-live": "polite" } }, resultView()),
    );
    const card = h(
      "div",
      { className: "card", attributes: { role: "group", "aria-label": `Prediction market: ${market.eventTitle}` } },
      body,
      h(
        "div",
        { className: "foot" },
        "Trade on ",
        h("strong", { text: "Gemini" }),
        " · settled in USDC on Solana",
        options.researchHref === undefined
          ? null
          : h("a", { className: "research", text: "Research ↗", attributes: { href: options.researchHref, target: "_blank", rel: "noopener noreferrer", "data-key": "research" } }),
      ),
    );
    root.replaceChildren(card);
    if (focusKey) shadow.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
  }

  render();

  return {
    host,
    postId: initial.postId,
    symbol: initial.market.instrumentSymbol,
    update: (quote) => { dispatch({ type: "quote-received", quote }); },
  };
}
