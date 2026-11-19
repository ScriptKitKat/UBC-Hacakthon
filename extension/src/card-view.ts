import { parseDollarsToCents, payoutFor } from "@/shared";
import { canBuy, cardReducer, initialCardState, isBusy } from "./card-state";
import type { CardAction } from "./card-state";
import { ensureCardFont } from "./card-font";
import { CARD_CSS } from "./card-styles";
import { h, svg } from "./dom";
import type { Child } from "./dom";
import { subscribePageTheme } from "./card-theme";
import { formatDeadline, friendlyEventTitle } from "./card-title";
import { formatCents, formatChangePercent, formatHistoryWindow, formatPercent, formatUsdc } from "./format";
import type { Sender } from "./protocol";
import { isSafeExplorerLink, isSafeGeminiLink } from "./safe-link";
import { buildSparkline } from "./sparkline";
import { needsApprovalNote, overTradeLimitMessage } from "./trade-budget";
import type { TradeBudget } from "./trade-budget";
import type { WireEntry, WireMatched, WireQuote } from "./wire";

export const CARD_HOST_ATTRIBUTE = "data-ntd-card";
const CHART_WIDTH = 96;
const CHART_HEIGHT = 32;
const BUBBLING_EVENTS = ["click", "change", "input", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "touchstart", "touchend"];

export interface CardHandle {
  readonly host: HTMLElement;
  readonly postId: string;
  readonly symbol: string;
  readonly update: (quote: WireQuote) => void;
  readonly updateBudget: (budget: TradeBudget | undefined) => void;
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
  return `${formatUsdc(entry.notionalCents)} on ${entry.outcome === "yes" ? "Yes" : "No"}`;
}

export interface CardOptions {
  readonly researchHref?: string;
  readonly researchHrefFor?: (symbol: string) => string | undefined;
  readonly budget?: TradeBudget;
  readonly onTradeSettled?: () => void;
}

export function createCard(initial: WireMatched, send: Sender, options: CardOptions = {}): CardHandle {
  ensureCardFont(document);
  let state = initialCardState(initial, options.budget);
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
    if (reply.ok) options.onTradeSettled?.();
  }

  async function approve(): Promise<void> {
    if (state.status.phase !== "needs-approval") return;
    const { intentId } = state.status.entry;
    dispatch({ type: "approve-started" });
    const reply = await send({ type: "confirm", intentId });
    dispatch(reply.ok ? { type: "approve-settled", entry: reply.value } : { type: "approve-failed", message: reply.error });
    if (reply.ok) options.onTradeSettled?.();
  }

  function resultView(): Child {
    const { status } = state;
    switch (status.phase) {
      case "idle":
        return null;
      case "buying":
        return h("div", { className: "result", attributes: { "data-tone": "pending" } }, h("span", { className: "result-title", text: "Placing order…" }));
      case "filled": {
        const { explorerUrl, signature, ticket } = status.entry;
        const hasReceipt = signature !== undefined && signature.trim() !== "" && explorerUrl !== undefined && isSafeExplorerLink(explorerUrl);
        return h(
          "div",
          { className: "result", attributes: { "data-tone": "filled" } },
          h("span", { className: "result-title", text: ticket?.mode === "paper" ? "Simulated prediction" : "Order recorded" }),
          h("span", { className: "result-detail", text: entrySummary(status.entry) }),
          h("span", { className: "result-note", text: hasReceipt ? "USDC payment on Solana" : "No transaction receipt" }),
          hasReceipt
            ? h("a", { className: "link", text: "View transaction ↗", attributes: { href: explorerUrl, target: "_blank", rel: "noopener noreferrer" } })
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
    const amountError = amountCents === undefined || amountCents <= 0
      ? "Enter a USDC amount above 0 with up to two decimal places."
      : overTradeLimitMessage(amountCents, state.budget);
    const approvalNote = amountError === null && amountCents !== undefined ? needsApprovalNote(amountCents, state.budget) : null;
    const payout = payoutFor(price, amountError === null ? amountCents ?? 0 : 0, market.quantityLimits);
    const amount = h("input", { className: "amount-input", attributes: {
      type: "text", inputmode: "decimal", "aria-label": "Trade amount in USDC", "data-key": "amount",
      value: state.amountText, placeholder: "0.00", maxlength: "16", autocomplete: "off", spellcheck: "false",
      "aria-invalid": String(amountError !== null), ...(locked ? { disabled: "" } : {}),
    } });
    amount.addEventListener("input", userOnly(() => { dispatch({ type: "amount-edited", amountText: amount.value }); }));
    const outcomeButton = (side: "yes" | "no", cents: number | null) =>
      h("button", {
        className: outcome === side ? "outcome is-selected" : "outcome",
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
      h("label", { className: "amount-field" }, h("span", { className: "amount-label", text: "Amount" }), h("span", { className: "amount-value" }, h("span", { className: "amount-editor" }, h("span", { className: "amount-mirror", text: state.amountText || "0.00", attributes: { "aria-hidden": "true" } }), amount), h("span", { className: "amount-unit", text: "USDC", attributes: { "aria-hidden": "true" } }))),
      amountError === null ? null : h("div", { className: "amount-error", text: amountError, attributes: { role: "status" } }),
      h("div", { className: "estimate", attributes: { "aria-live": "polite", "data-outcome": outcome } },
        h("div", { className: "payout", text: payout.kind === "quote" ? `${formatPercent(price)} chance · ${formatUsdc(Math.floor(payout.payoutCents))} potential payout` : "Payout unavailable" }),
        payout.kind === "below-minimum" ? h("div", { className: "estimate-note", text: `Minimum ${String(payout.minimumContracts)} contracts` }) : null,
        approvalNote === null ? null : h("div", { className: "estimate-note", text: approvalNote }),
      ),
      market.tradeable ? null : h("div", { className: "blocked", text: market.tradeBlockedReason ?? "Trading is unavailable for this market." }),
      h("button", { className: "buy", text: isBusy(state) ? "Placing order…" : "Trade now", attributes: {
        type: "button", "data-key": "trade", "aria-label": `Trade ${outcome} for ${formatUsdc(amountCents ?? 0)} at ${formatCents(price)}`,
        ...(enabled ? {} : { disabled: "" }),
      }, on: { click: userOnly(() => void buy()) } }),
    );
  }

  const listId = `ntd-contract-list-${initial.postId}`;
  let listOpen = false;
  let activeIndex = 0;
  const eventTitle = h("div", { className: "title" });
  const contractLabel = h("span", { className: "contract-label" });
  const trigger = h("button", {
    className: "contract-trigger",
    attributes: {
      type: "button",
      "data-key": "contract",
      "aria-label": "Prediction contract",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
      "aria-controls": listId,
    },
  }, contractLabel, svg("svg", { className: "contract-chevron", attributes: { viewBox: "0 0 24 24", "aria-hidden": "true" } }, svg("path", { attributes: { d: "m6 9 6 6 6-6", fill: "none", stroke: "currentColor", "stroke-width": "2.5", "stroke-linecap": "round", "stroke-linejoin": "round" } })));
  const list = h("div", { className: "contract-list", attributes: { role: "listbox", id: listId, "aria-label": "Prediction contract", hidden: "" } });
  const picker = h("div", { className: "contract-picker" }, trigger, list);
  const expiry = h("div", { className: "deadline" });
  const chartWrap = h("div", { className: "chart-block" });

  function closeList(restoreFocus = true): void {
    if (!listOpen) return;
    listOpen = false;
    renderPicker();
    if (restoreFocus) trigger.focus();
  }

  function openList(): void {
    if (isBusy(state) || state.status.phase === "needs-approval") return;
    listOpen = true;
    const index = state.contracts.findIndex((contract) => contract.instrumentSymbol === state.market.instrumentSymbol);
    activeIndex = index < 0 ? 0 : index;
    renderPicker();
    list.focus();
  }

  function selectContract(symbol: string): void {
    const previous = state.market.instrumentSymbol;
    listOpen = false;
    dispatch({ type: "contract-selected", symbol });
    trigger.focus();
    if (state.market.instrumentSymbol !== previous) void requestQuote();
  }

  async function requestQuote(): Promise<void> {
    const symbol = state.market.instrumentSymbol;
    try {
      const reply = await send({ type: "quote", symbol });
      if (reply.ok && state.market.instrumentSymbol === symbol) dispatch({ type: "quote-received", quote: reply.value });
    } catch {
      return;
    }
  }

  function moveActive(delta: number): void {
    const count = state.contracts.length;
    if (count === 0) return;
    activeIndex = (activeIndex + delta + count) % count;
    renderPicker();
  }

  function onTriggerKey(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const locked = isBusy(state) || state.status.phase === "needs-approval";
    if (locked) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openList();
    } else if (event.key === "Escape") closeList();
  }

  function onListKey(event: Event): void {
    if (!(event instanceof KeyboardEvent) || !listOpen) return;
    if (event.key === "ArrowDown") { event.preventDefault(); moveActive(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); moveActive(-1); }
    else if (event.key === "Home") { event.preventDefault(); activeIndex = 0; renderPicker(); }
    else if (event.key === "End") { event.preventDefault(); activeIndex = Math.max(0, state.contracts.length - 1); renderPicker(); }
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const contract = state.contracts[activeIndex];
      if (contract !== undefined) selectContract(contract.instrumentSymbol);
    } else if (event.key === "Escape") { event.preventDefault(); closeList(); }
    else if (event.key === "Tab") closeList(false);
  }

  trigger.addEventListener("click", userOnly(() => { if (listOpen) closeList(); else openList(); }));
  trigger.addEventListener("keydown", onTriggerKey);
  list.addEventListener("keydown", onListKey);
  document.addEventListener("pointerdown", (event) => {
    if (!listOpen || !host.isConnected) return;
    const path = event.composedPath();
    if (!path.includes(picker)) closeList(false);
  }, true);
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
      h("div", { className: "titles" }, eventTitle, expiry),
      chartWrap,
    ),
    picker,
    trade,
    status,
  );
  const card = h("div", { className: "card", attributes: { role: "group", "data-theme": "light" } }, body, foot);
  root.append(card);
  subscribePageTheme(document, host, (theme) => { card.dataset.theme = theme; });


  function renderPicker(): void {
    const { market, contracts } = state;
    const locked = isBusy(state) || state.status.phase === "needs-approval";
    trigger.disabled = locked;
    trigger.setAttribute("aria-expanded", String(listOpen));
    picker.setAttribute("data-open", String(listOpen));
    list.hidden = !listOpen;
    if (listOpen) list.setAttribute("tabindex", "0");
    else list.removeAttribute("tabindex");
    const active = contracts[activeIndex] ?? contracts[0];
    if (active !== undefined) list.setAttribute("aria-activedescendant", `${listId}-${active.instrumentSymbol}`);
    else list.removeAttribute("aria-activedescendant");
    list.replaceChildren(...contracts.map((contract, index) => {
      const selected = contract.instrumentSymbol === market.instrumentSymbol;
      const className = index === activeIndex ? "contract-option is-active" : "contract-option";
      return h("div", {
        className,
        attributes: {
          role: "option",
          id: `${listId}-${contract.instrumentSymbol}`,
          "data-symbol": contract.instrumentSymbol,
          "aria-selected": String(selected),
        },
        on: { click: userOnly(() => { selectContract(contract.instrumentSymbol); }) },
      }, h("span", { className: "contract-option-label", text: contract.contractLabel }), h("span", { className: "contract-option-chance", text: formatPercent(contract.yesCents ?? contract.impliedYesPercent) }));
    }));
  }

  function chartView(): Child[] {
    const sparkline = buildSparkline(state.history.map((point) => point.yesCents), CHART_WIDTH, CHART_HEIGHT);
    if (sparkline === undefined) return [];
    const first = state.history[0];
    const last = state.history.at(-1);
    const change = first !== undefined && last !== undefined && state.history.length > 1
      ? formatChangePercent(first.yesCents, last.yesCents)
      : null;
    const window = first !== undefined && last !== undefined ? formatHistoryWindow(first.at, last.at) : null;
    const label = change === null ? null : window === null ? `${change} Yes` : `${change} ${window}`;
    const chart = svg("svg", { attributes: { viewBox: `0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`, role: "img", "aria-label": "Yes price history" } });
    chart.append(
      svg("path", { className: "area", attributes: { d: sparkline.area, "data-trend": sparkline.trend } }),
      svg("path", { className: "line", attributes: { d: sparkline.line, "data-trend": sparkline.trend } }),
    );
    return [
      h("div", { className: "chart" }, chart),
      label === null ? null : h("div", { className: "change", text: label, attributes: { "data-trend": sparkline.trend } }),
    ];
  }

  function render(): void {


    const focused = shadow.activeElement;
    const focusKey = focused?.getAttribute("data-key");
    const selection = focused instanceof HTMLInputElement ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : undefined;
    const { market, contracts } = state;
    const locked = isBusy(state) || state.status.phase === "needs-approval";
    if (locked) listOpen = false;
    if (activeIndex >= contracts.length) activeIndex = Math.max(0, contracts.length - 1);
    picker.setAttribute("data-disabled", String(locked));
    const title = friendlyEventTitle(market.eventTitle, market.expiryDate);
    eventTitle.textContent = title;
    eventTitle.title = market.description ?? title;
    contractLabel.textContent = market.contractLabel;
    renderPicker();
    chartWrap.replaceChildren(...chartView().filter((child): child is Node => child !== null));
    const closes = formatDeadline(market.expiryDate);
    expiry.hidden = closes === null;
    expiry.textContent = closes;
    card.setAttribute("aria-label", `Prediction market: ${title}`);
    const nextTrade = tradeView();
    trade.replaceWith(nextTrade);
    trade = nextTrade;
    const result = resultView();
    status.replaceChildren(...(result === null ? [] : [result]));
    const researchHref = options.researchHrefFor?.(market.instrumentSymbol) ?? options.researchHref;
    foot.replaceChildren(...[
        "Trade on ",
        market.geminiUrl !== undefined && isSafeGeminiLink(market.geminiUrl)
          ? h("a", { className: "gemini", text: "Gemini", attributes: { href: market.geminiUrl, target: "_blank", rel: "noopener noreferrer", "data-key": "gemini" } })
          : h("strong", { text: "Gemini" }),
        researchHref === undefined
          ? null
          : h("span", {}, " · ", h("a", { className: "research", text: "Research to understand more ↗", attributes: { href: researchHref, target: "_blank", rel: "noopener noreferrer", "data-key": "research" } })),
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
    updateBudget: (budget) => { dispatch({ type: "budget-received", budget }); },
  };
}
