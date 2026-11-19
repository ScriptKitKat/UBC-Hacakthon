export const CARD_COLORS = {
  accent: "rgb(26, 107, 255)",
  cyan: "rgb(38, 221, 249)",
  surface: "rgb(255, 255, 255)",
  text: "rgb(11, 15, 20)",
  yes: "rgb(17, 166, 66)",
  no: "rgb(196, 70, 70)",
  border: "rgb(38, 221, 249)",
  up: "rgb(17, 166, 66)",
  down: "rgb(196, 70, 70)",
} as const;

export const CARD_MAX_WIDTH_PX = 360;

export const CARD_CSS = `
:host { all: initial; display: block; width: 360px; max-width: 100%; margin-top: 10px; color-scheme: inherit; container-type: inline-size; }
*, *::before, *::after { box-sizing: border-box; }
.card {
  --ntd-accent: ${CARD_COLORS.accent};
  --ntd-cyan: ${CARD_COLORS.cyan};
  --ntd-surface: ${CARD_COLORS.surface};
  --ntd-text: ${CARD_COLORS.text};
  --ntd-muted: rgb(102, 112, 122);
  --ntd-track: rgb(242, 244, 246);
  --ntd-selected: rgb(220, 231, 255);
  --ntd-line: rgb(215, 221, 228);
  --ntd-yes: ${CARD_COLORS.yes};
  --ntd-no: ${CARD_COLORS.no};
  --ntd-yes-fill: rgb(209, 239, 219);
  --ntd-no-fill: rgb(250, 224, 224);
  --ntd-yes-area: rgba(17, 166, 66, 0.14);
  --ntd-no-area: rgba(196, 70, 70, 0.14);
  --ntd-flat-area: rgba(102, 112, 122, 0.12);
  --ntd-error: rgb(198, 40, 74);
  width: ${String(CARD_MAX_WIDTH_PX)}px; max-width: 100%; overflow: visible;
  border: 1.5px solid var(--ntd-cyan); border-radius: 20px;
  background: var(--ntd-surface); color: var(--ntd-text);
  font: 500 13px/18px "NTD Manrope", ui-rounded, "Avenir Next", "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums; text-align: left; -webkit-font-smoothing: antialiased;
  color-scheme: light;
}
.card[data-theme="dark"] {
  --ntd-surface: #101820;
  --ntd-text: #e8eef6;
  --ntd-muted: #8b98a8;
  --ntd-track: #1a2330;
  --ntd-selected: #1a3a72;
  --ntd-line: #2a3848;
  --ntd-yes: rgb(86, 214, 132);
  --ntd-no: rgb(255, 138, 138);
  --ntd-yes-fill: rgb(16, 52, 34);
  --ntd-no-fill: rgb(64, 24, 28);
  --ntd-yes-area: rgba(86, 214, 132, 0.2);
  --ntd-no-area: rgba(255, 138, 138, 0.2);
  --ntd-flat-area: rgba(139, 152, 168, 0.16);
  --ntd-error: #ff6eae;
  color-scheme: dark;
}
.body { padding: 12px 14px 10px; display: grid; gap: 10px; }
.head { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 8px; align-items: start; }
.icon { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg, #00b9f5, #1a6bff); }
.icon svg { width: 16px; height: 16px; }
.titles { min-width: 0; }
.title { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--ntd-muted); overflow-wrap: anywhere; }
.deadline { font-size: 11px; line-height: 15px; color: var(--ntd-muted); }
.chart-block { display: grid; justify-items: end; align-content: start; gap: 1px; min-width: 0; }
.chart-block:empty { display: none; }
.chart { width: 96px; height: 32px; }
.chart svg { width: 100%; height: 100%; display: block; overflow: visible; }
.line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.line[data-trend="up"] { stroke: var(--ntd-yes); }
.line[data-trend="down"] { stroke: var(--ntd-no); }
.line[data-trend="flat"] { stroke: var(--ntd-muted); }
.area[data-trend="up"] { fill: var(--ntd-yes-area); }
.area[data-trend="down"] { fill: var(--ntd-no-area); }
.area[data-trend="flat"] { fill: var(--ntd-flat-area); }
.change { font-size: 10px; line-height: 12px; font-weight: 700; white-space: nowrap; color: var(--ntd-muted); }
.change[data-trend="up"] { color: var(--ntd-yes); }
.change[data-trend="down"] { color: var(--ntd-no); }
button, select, input, a { font: inherit; }
.contract-picker { position: relative; display: grid; max-width: 100%; }
.contract-picker[data-disabled="true"] { opacity: .5; }
.contract-trigger { display: grid; grid-template-columns: minmax(0, 1fr) 16px; align-items: center; gap: 6px; width: 100%; margin: 0; padding: 0; border: 0; background: transparent; color: var(--ntd-text); font-size: 18px; line-height: 24px; font-weight: 700; letter-spacing: -.4px; text-align: left; cursor: pointer; }
.contract-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contract-chevron { width: 16px; height: 16px; pointer-events: none; color: var(--ntd-muted); }
.contract-picker[data-open="true"] .contract-chevron { transform: rotate(180deg); }
.contract-list { position: absolute; z-index: 8; top: calc(100% + 6px); left: 0; right: 0; margin: 0; padding: 6px; border: 1.5px solid var(--ntd-cyan); border-radius: 14px; background: var(--ntd-surface); color: var(--ntd-text); box-shadow: none; max-height: 220px; overflow: auto; }
.contract-list[hidden] { display: none; }
.contract-option { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%; margin: 0; padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--ntd-text); font-size: 13px; line-height: 18px; font-weight: 650; text-align: left; cursor: pointer; }
.contract-option.is-active { background: var(--ntd-track); }
.contract-option[aria-selected="true"] { background: var(--ntd-selected); }
.contract-option-chance { color: var(--ntd-muted); font-weight: 600; font-variant-numeric: tabular-nums; }
.contract-option[aria-selected="true"] .contract-option-chance { color: var(--ntd-accent); }
.trade { display: grid; gap: 10px; }
.outcomes { display: grid; grid-template-columns: 1fr 1fr; padding: 0; gap: 0; border: 0; border-radius: 999px; background: var(--ntd-track); overflow: hidden; }
.outcome { min-height: 36px; padding: 6px 8px; border-radius: 999px; border: 1.5px solid transparent; background: transparent; color: var(--ntd-muted); font-size: 13px; line-height: 18px; font-weight: 650; cursor: pointer; box-shadow: none; }
.outcome[data-outcome="yes"].is-selected { background: var(--ntd-yes-fill); border-color: var(--ntd-yes); color: var(--ntd-yes); box-shadow: none; }
.outcome[data-outcome="no"].is-selected { background: var(--ntd-no-fill); border-color: var(--ntd-no); color: var(--ntd-no); box-shadow: none; }
.amount-field { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; padding: 8px 12px; border: 1px solid var(--ntd-line); border-radius: 14px; background: var(--ntd-surface); cursor: text; }
.amount-label { font-weight: 650; font-size: 13px; color: var(--ntd-text); }
.amount-value { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; max-width: 75%; font-size: 22px; line-height: 28px; font-weight: 650; letter-spacing: -.6px; }
.amount-unit { font-size: 11px; line-height: 16px; letter-spacing: 0; color: var(--ntd-muted); }
.amount-editor { position: relative; min-width: 0; }
.amount-mirror { visibility: hidden; white-space: pre; }
.amount-input { position: absolute; inset: 0; width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--ntd-text); font: inherit; letter-spacing: inherit; font-variant-numeric: inherit; text-align: right; }
.amount-error { color: var(--ntd-error); font-size: 11px; line-height: 15px; }
.estimate { text-align: center; }
.payout { color: var(--ntd-accent); font-weight: 600; font-size: 12px; line-height: 16px; }
.estimate[data-outcome="no"] .payout { color: var(--ntd-accent); }
.estimate-note { margin-top: 2px; color: var(--ntd-muted); font-size: 11px; line-height: 14px; }
.buy { width: 100%; min-height: 40px; padding: 8px 14px; border: 0; border-radius: 999px; background: var(--ntd-accent); color: rgb(255, 255, 255); font-weight: 650; font-size: 14px; box-shadow: none; cursor: pointer; }
button:disabled, input:disabled { opacity: .5; cursor: not-allowed; }
select:disabled { cursor: not-allowed; }
button:focus-visible, input:focus-visible, a:focus-visible, .contract-trigger:focus-visible, .contract-list:focus-visible { outline: 2px solid var(--ntd-accent); outline-offset: 2px; }
.blocked { color: var(--ntd-muted); font-size: 12px; line-height: 16px; }
.result { border-radius: 10px; padding: 7px 10px; font-size: 12px; line-height: 16px; display: grid; gap: 4px; overflow-wrap: anywhere; }
.result[data-tone="filled"] { background: var(--ntd-selected); color: var(--ntd-accent); }
.result[data-tone="approval"] { background: rgba(255,173,31,.12); color: rgb(200,130,20); }
.result[data-tone="refused"] { background: rgba(196,70,70,.12); color: var(--ntd-no); }
.result[data-tone="quiet"], .result[data-tone="pending"] { background: var(--ntd-track); color: var(--ntd-muted); }
.result-title { font-weight: 700; }
.status:empty { display: none; }
.result-detail { color: var(--ntd-text); }
.result-note { color: var(--ntd-muted); font-size: 11px; }
.link { color: var(--ntd-accent); text-decoration: none; font-weight: 650; }
.approve { justify-self: start; min-height: 32px; padding: 0 14px; border-radius: 999px; border: 0; background: var(--ntd-accent); color: rgb(255, 255, 255); box-shadow: none; font-weight: 650; cursor: pointer; }
.foot { padding: 8px 12px; text-align: center; font-size: 11px; line-height: 16px; color: var(--ntd-muted); background: transparent; border-top: 1px solid var(--ntd-line); }
.foot a { color: var(--ntd-accent); font-weight: 650; text-underline-offset: 2px; }
a:hover { text-decoration: underline; }
@container (max-width: 300px) {
  .body { padding: 10px 10px 8px; }
  .head { grid-template-columns: 24px minmax(0, 1fr); gap: 6px; }
  .chart-block { grid-column: 1 / -1; justify-items: stretch; }
  .chart { width: 100%; height: 28px; }
  .change { justify-self: end; }
  .icon { width: 24px; height: 24px; }
  .icon svg { width: 14px; height: 14px; }
  .contract-trigger { font-size: 16px; }
  .outcome { font-size: 12px; min-height: 32px; }
  .amount-field { padding: 7px 10px; }
  .amount-value { font-size: 18px; line-height: 24px; }
  .payout { font-size: 11px; }
}
@media (prefers-reduced-motion: no-preference) {
  button { transition: filter 120ms ease, background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
  button:hover:not(:disabled) { filter: brightness(1.06); }
  .contract-chevron { transition: transform 120ms ease; }
}
`;
