import type { FeedPositions } from "@/shared";
import { CARD_COLORS } from "./card-styles";
import { h } from "./dom";
import type { BackgroundReply } from "./protocol";
import { parseDeskUrl } from "./settings";

export const POPUP_CSS = `
* { box-sizing: border-box; }
body {
  width: 360px; margin: 0; padding: 12px; background: #000; color: ${CARD_COLORS.text};
  color-scheme: dark; font: 14px/20px -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
section { background: ${CARD_COLORS.surface}; border: 1px solid ${CARD_COLORS.border}; border-radius: 16px; overflow: hidden; }
h1, p { margin: 0; }
h1, .message { padding: 12px; font-size: 14px; }
ul { list-style: none; margin: 0; padding: 0; }
li { padding: 10px 12px; border-top: 1px solid ${CARD_COLORS.border}; display: grid; gap: 4px; overflow-wrap: anywhere; }
.line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.label, .details { color: #a8adb2; font-size: 13px; }
.details { font-variant-numeric: tabular-nums; }
.side { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; font-weight: 700; }
[data-tone="up"] { color: ${CARD_COLORS.up}; }
[data-tone="down"] { color: ${CARD_COLORS.down}; }
.links { display: flex; gap: 12px; }
a { color: #65baff; }
`;

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const signedDollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });
const signedPercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero" });

function link(text: string, href: string, label = text): HTMLAnchorElement {
  return h("a", { text, attributes: { href, target: "_blank", rel: "noopener noreferrer", "aria-label": label } });
}

function explorerLink(url: string | null): HTMLAnchorElement | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? link("↗", parsed.href, "View payment in explorer") : null;
  } catch {
    return null;
  }
}

function positionRow(position: FeedPositions["positions"][number], origin: string | undefined): HTMLLIElement {
  const research = origin !== undefined && /^\/markets\/[A-Za-z0-9%_-]+$/u.test(position.researchPath)
    ? link("Research", origin + position.researchPath)
    : null;
  const { pnlCents, pnlPercent, currentCents } = position;
  const pnl = pnlCents === null ? "—" : signedDollars.format(pnlCents / 100);
  const percent = pnlPercent === null ? "" : ` (${signedPercent.format(pnlPercent / 100)})`;
  const tone = pnlCents === null || pnlCents === 0 ? "flat" : pnlCents > 0 ? "up" : "down";
  const current = currentCents === null ? "no bid" : `${String(currentCents)}¢`;
  return h("li", {},
    h("div", { className: "line" },
      h("strong", { text: position.eventTitle ?? position.symbol }),
      h("span", { className: "side", text: position.outcome.toUpperCase(), attributes: { "data-tone": position.outcome === "yes" ? "up" : "down" } }),
    ),
    h("p", { className: "label", text: position.contractLabel ?? position.symbol }),
    h("div", { className: "line details" },
      h("span", { text: `${String(position.contracts)} @ ${String(position.averageEntryCents)}¢ → ${current}` }),
      h("strong", { text: pnl + percent, attributes: { "data-tone": tone } }),
    ),
    h("div", { className: "links" },
      explorerLink(position.explorerUrl),
      research,
    ),
  );
}

export function renderPositions(reply: BackgroundReply<FeedPositions>, deskUrl: string): HTMLElement {
  if (!reply.ok) {
    return h("section", {}, h("p", { className: "message" }, reply.error, " ", link("Extension options", "options.html")));
  }
  const { positions, budget } = reply.value;
  const origin = parseDeskUrl(deskUrl);
  return h("section", {},
    h("h1", { text: `Today: ${dollars.format(budget.remainingCents / 100)} left of ${dollars.format(budget.dailyCapCents / 100)}` }),
    positions.length === 0
      ? h("p", { className: "message", text: "No open positions" })
      : h("ul", {}, ...positions.map((position) => positionRow(position, origin))),
  );
}
