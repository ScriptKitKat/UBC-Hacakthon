export const CARD_COLORS = {
  surface: "rgb(16, 21, 18)",
  text: "rgb(237, 242, 234)",
  border: "rgba(168, 192, 143, .48)",
  up: "rgb(186, 221, 170)",
  down: "rgb(231, 202, 167)",
} as const;

export const CARD_CSS = `
:host { all: initial; display: block; margin-top: 12px; color-scheme: dark; container-type: inline-size; }
*, *::before, *::after { box-sizing: border-box; }
.card {
  width: 100%; max-width: 516px; overflow: hidden; border: 1px solid ${CARD_COLORS.border}; border-radius: 24px;
  background: radial-gradient(ellipse at 90% 0%, rgba(98, 132, 110, .17), transparent 60%), linear-gradient(145deg, #1b211e, ${CARD_COLORS.surface} 65%); color: ${CARD_COLORS.text};
  box-shadow: 0 0 24px rgba(162, 190, 141, .08), inset 0 1px 0 rgba(235, 244, 229, .06);
  font: 500 15px/22px "NTD Manrope", ui-rounded, "Avenir Next", "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums; text-align: left; -webkit-font-smoothing: antialiased;
}
.body { padding: 20px; display: grid; gap: 18px; }
.head { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 12px; align-items: center; }
.icon { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg, #00b9f5, #1a6bff); }
.icon svg { width: 28px; height: 28px; }
.titles { min-width: 0; }
.title { font-size: 14px; line-height: 20px; color: #b3bdb5; overflow-wrap: anywhere; }
.deadline { font-size: 11px; line-height: 16px; color: #a3afa5; }
button, select, input, a { font: inherit; }
.contract-picker { position: relative; display: inline-grid; grid-template-columns: minmax(0, 1fr) 18px; align-items: center; gap: 8px; max-width: 100%; padding: 3px 0; font-size: 24px; line-height: 32px; font-weight: 700; letter-spacing: -.6px; }
.contract-picker[data-disabled="true"] { opacity: .5; }
.contract-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contract { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.contract-chevron { width: 18px; height: 18px; pointer-events: none; color: #d4dfcf; }
.contract option { background: ${CARD_COLORS.surface}; color: ${CARD_COLORS.text}; font-size: 16px; }
.trade { display: grid; gap: 16px; }
.outcomes { display: grid; grid-template-columns: 1fr 1fr; padding: 4px; gap: 4px; border: 1px solid rgba(191, 210, 180, .16); border-radius: 999px; background: rgba(0, 0, 0, .2); box-shadow: inset 0 1px 6px rgba(0, 0, 0, .18); }
.outcome { min-height: 46px; padding: 8px; border-radius: 999px; border: 1px solid transparent; background: transparent; color: #b3bdb5; font-size: 20px; line-height: 26px; font-weight: 650; cursor: pointer; }
.outcome[data-outcome="yes"][aria-pressed="true"] { background: linear-gradient(145deg, rgba(188, 211, 181, .2), rgba(117, 152, 134, .1)); border-color: rgba(186, 221, 170, .5); color: ${CARD_COLORS.up}; box-shadow: 0 0 16px rgba(175, 210, 152, .1), inset 0 1px 0 rgba(255, 255, 255, .09); }
.outcome[data-outcome="no"][aria-pressed="true"] { background: linear-gradient(145deg, rgba(231, 202, 167, .18), rgba(157, 132, 103, .08)); border-color: rgba(231, 202, 167, .5); color: ${CARD_COLORS.down}; box-shadow: 0 0 16px rgba(231, 202, 167, .08), inset 0 1px 0 rgba(255, 255, 255, .09); }
.amount-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 16px; border: 1px solid rgba(191, 210, 180, .24); border-radius: 18px; background: rgba(5, 10, 7, .26); box-shadow: inset 0 1px 8px rgba(0, 0, 0, .15); cursor: text; }
.amount-label { font-weight: 650; }
.amount-value { display: flex; align-items: center; justify-content: flex-end; min-width: 0; max-width: 75%; font-size: 32px; line-height: 40px; font-weight: 650; letter-spacing: -1px; }
.amount-editor { position: relative; min-width: 0; }
.amount-mirror { visibility: hidden; white-space: pre; }
.amount-input { position: absolute; inset: 0; width: 100%; min-width: 0; padding: 0; border: 0; background: transparent; color: ${CARD_COLORS.text}; font: inherit; letter-spacing: inherit; font-variant-numeric: inherit; text-align: right; }
.amount-error { color: #ff6eae; font-size: 12px; line-height: 18px; }
.estimate { text-align: center; }
.payout { color: ${CARD_COLORS.up}; font-weight: 600; line-height: 24px; }
.estimate[data-outcome="no"] .payout { color: ${CARD_COLORS.down}; }
.estimate-note { margin-top: 3px; color: #a7b1ba; font-size: 11px; line-height: 16px; }
.buy { width: 100%; min-height: 48px; padding: 12px 16px; border: 1px solid rgba(188, 211, 170, .5); border-radius: 999px; background: linear-gradient(165deg, #384238, #1c251e 70%); color: #f0f5eb; font-weight: 650; box-shadow: 0 0 22px rgba(172, 202, 148, .12), inset 0 1px 0 rgba(255, 255, 255, .13); cursor: pointer; }
button:disabled, input:disabled { opacity: .5; cursor: not-allowed; }
select:disabled { cursor: not-allowed; }
button:focus-visible, input:focus-visible, a:focus-visible, .contract-picker:focus-within { outline: 2px solid #bed5ac; outline-offset: 3px; }
.blocked { color: #a7b1ba; font-size: 13px; line-height: 18px; }
.result { border-radius: 12px; padding: 8px 12px; font-size: 14px; line-height: 18px; display: grid; gap: 6px; overflow-wrap: anywhere; }
.result[data-tone="filled"] { background: rgba(0,186,124,.12); color: ${CARD_COLORS.up}; }
.result[data-tone="approval"] { background: rgba(255,173,31,.12); color: rgb(255,173,31); }
.result[data-tone="refused"] { background: rgba(249,24,128,.12); color: ${CARD_COLORS.down}; }
.result[data-tone="quiet"], .result[data-tone="pending"] { background: rgba(113,118,123,.12); color: #a7b1ba; }
.result-title { font-weight: 700; }
.status:empty { display: none; }
.result-detail { color: ${CARD_COLORS.text}; }
.link { color: #d0e4bf; text-decoration: none; font-weight: 650; }
.approve { justify-self: start; min-height: 36px; padding: 0 16px; border-radius: 999px; border: 1px solid rgba(231, 202, 167, .5); background: linear-gradient(155deg, #423b2e, #272218); color: #f2dec4; box-shadow: 0 0 16px rgba(231, 202, 167, .08), inset 0 1px 0 rgba(255, 255, 255, .1); font-weight: 650; cursor: pointer; }
.foot { padding: 13px 16px; text-align: center; font-size: 12px; line-height: 18px; color: #a8b4aa; background: rgba(0, 0, 0, .18); border-top: 1px solid rgba(168, 192, 143, .18); }
.foot a { color: #d9e6d0; font-weight: 650; text-underline-offset: 3px; }
a:hover { text-decoration: underline; color: #edfae5; }
@container (max-width: 300px) {
  .body { padding: 16px 12px; }
  .head { grid-template-columns: 32px minmax(0, 1fr); gap: 8px; }
  .icon { width: 32px; height: 32px; }
  .icon svg { width: 22px; height: 22px; }
  .contract-picker { font-size: 18px; gap: 6px; }
  .outcome { font-size: 17px; white-space: nowrap; }
  .amount-field { padding: 12px; }
  .amount-label { font-size: 13px; }
  .amount-value { font-size: 24px; line-height: 32px; }
  .payout { font-size: 13px; }
}
@media (prefers-reduced-motion: no-preference) {
  button { transition: filter 120ms ease; }
  button:hover:not(:disabled) { filter: brightness(1.12); }
}
`;
