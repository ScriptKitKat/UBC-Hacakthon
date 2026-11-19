export const CARD_COLORS = {
  surface: "rgb(21, 24, 28)",
  text: "rgb(231, 233, 234)",
  border: "rgb(47, 51, 54)",
  up: "rgb(0, 186, 124)",
  down: "rgb(249, 24, 128)",
} as const;

export const CARD_CSS = `
:host { all: initial; display: block; margin-top: 12px; color-scheme: dark; }
*, *::before, *::after { box-sizing: border-box; }
.card {
  width: 100%; max-width: 516px; overflow: hidden; border: 1px solid ${CARD_COLORS.border}; border-radius: 20px;
  background: ${CARD_COLORS.surface}; color: ${CARD_COLORS.text};
  font: 15px/20px TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  text-align: left;
}
.body { padding: 20px; display: grid; gap: 18px; }
.head { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 12px; align-items: center; }
.icon { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg, #00b9f5, #1a6bff); }
.icon svg { width: 28px; height: 28px; }
.titles { min-width: 0; }
.title { font-size: 14px; line-height: 20px; color: #a7b1ba; overflow-wrap: anywhere; }
.deadline { font-size: 11px; line-height: 16px; color: #a7b1ba; }
button, select, a { font: inherit; }
.contract { display: block; width: 100%; padding: 2px 22px 2px 0; border: 0; background: transparent; color: ${CARD_COLORS.text}; font-size: 25px; line-height: 32px; font-weight: 750; letter-spacing: -.5px; cursor: pointer; text-overflow: ellipsis; }
.contract option { background: ${CARD_COLORS.surface}; color: ${CARD_COLORS.text}; font-size: 16px; }
.trade { display: grid; gap: 16px; }
.outcomes { display: grid; grid-template-columns: 1fr 1fr; padding: 4px; gap: 4px; border: 1px solid #3b4249; border-radius: 999px; background: #101317; }
.outcome { min-height: 46px; padding: 8px; border-radius: 999px; border: 1px solid transparent; background: transparent; color: #a7b1ba; font-size: 21px; line-height: 26px; font-weight: 700; cursor: pointer; }
.outcome[data-outcome="yes"][aria-pressed="true"] { background: rgba(0,186,124,.12); border-color: ${CARD_COLORS.up}; color: #42d7a3; }
.outcome[data-outcome="no"][aria-pressed="true"] { background: rgba(249,24,128,.12); border-color: ${CARD_COLORS.down}; color: #ff6eae; }
.stake { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; color: #a7b1ba; }
.chips { display: flex; gap: 6px; }
.chip { min-width: 48px; height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid #3b4249; background: transparent; color: #a7b1ba; font-weight: 650; cursor: pointer; }
.chip[aria-pressed="true"] { background: #e7e9ea; color: #0f1419; border-color: #e7e9ea; }
.estimate { text-align: center; }
.payout { color: #42d7a3; font-weight: 650; line-height: 24px; }
.estimate[data-outcome="no"] .payout { color: #ff6eae; }
.estimate-note { margin-top: 3px; color: #a7b1ba; font-size: 11px; line-height: 16px; }
.buy { width: 100%; min-height: 44px; padding: 10px 16px; border: 1px solid #329dff; border-radius: 999px; background: #1a6bff; color: #fff; font-weight: 750; cursor: pointer; }
button:disabled, select:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid #329dff; outline-offset: 3px; }
.blocked { color: #a7b1ba; font-size: 13px; line-height: 18px; }
.result { border-radius: 12px; padding: 8px 12px; font-size: 14px; line-height: 18px; display: grid; gap: 6px; overflow-wrap: anywhere; }
.result[data-tone="filled"] { background: rgba(0,186,124,.12); color: ${CARD_COLORS.up}; }
.result[data-tone="approval"] { background: rgba(255,173,31,.12); color: rgb(255,173,31); }
.result[data-tone="refused"] { background: rgba(249,24,128,.12); color: ${CARD_COLORS.down}; }
.result[data-tone="quiet"], .result[data-tone="pending"] { background: rgba(113,118,123,.12); color: #a7b1ba; }
.result-title { font-weight: 700; }
.status:empty { display: none; }
.result-detail { color: ${CARD_COLORS.text}; }
.link { color: #329dff; text-decoration: none; font-weight: 700; }
.approve { justify-self: start; min-height: 32px; padding: 0 16px; border-radius: 999px; border: 0; background: rgb(255,173,31); color: #0f1419; font-weight: 700; cursor: pointer; }
.foot { padding: 12px 16px; text-align: center; font-size: 12px; line-height: 18px; color: #a7b1ba; background: #101317; border-top: 1px solid ${CARD_COLORS.border}; }
.foot a { color: ${CARD_COLORS.text}; font-weight: 700; text-underline-offset: 3px; }
a:hover { text-decoration: underline; color: #329dff; }
@media (max-width: 380px) {
  .body { padding: 16px 12px; }
  .head { grid-template-columns: 40px minmax(0, 1fr); gap: 10px; }
  .icon { width: 40px; height: 40px; }
  .contract { font-size: 21px; }
  .outcome { font-size: 19px; }
  .payout { font-size: 13px; }
}
@media (prefers-reduced-motion: no-preference) {
  button { transition: filter 120ms ease; }
  button:hover:not(:disabled) { filter: brightness(1.12); }
}
`;
