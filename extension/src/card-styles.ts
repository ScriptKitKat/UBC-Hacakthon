export const CARD_CSS = `
:host { all: initial; display: block; margin-top: 12px; }
*, *::before, *::after { box-sizing: border-box; }
.card {
  width: 100%;
  max-width: 516px;
  overflow: hidden;
  border: 1px solid rgb(47, 51, 54);
  border-radius: 16px;
  background: #16181c;
  color: rgb(231, 233, 234);
  font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 20px;
  text-align: left;
}
.body { padding: 12px 16px; display: grid; gap: 12px; }
.head { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 12px; align-items: center; }
.icon {
  width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center;
  background: linear-gradient(135deg, #00dcfa, #1a6bff);
}
.icon svg { width: 24px; height: 24px; }
.titles { min-width: 0; }
.title { font-weight: 700; color: rgb(231, 233, 234); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub { color: rgb(113, 118, 123); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub strong { color: rgb(231, 233, 234); font-weight: 700; }
.pct { margin-left: 6px; font-weight: 700; }
.pct[data-trend="up"] { color: rgb(0, 186, 124); }
.pct[data-trend="down"] { color: rgb(249, 24, 128); }
.pct[data-trend="flat"] { color: rgb(113, 118, 123); }
.chart { width: 112px; height: 40px; }
.chart svg { width: 100%; height: 100%; display: block; overflow: visible; }
.line { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.line[data-trend="up"] { stroke: rgb(0, 186, 124); }
.line[data-trend="down"] { stroke: rgb(249, 24, 128); }
.line[data-trend="flat"] { stroke: rgb(113, 118, 123); }
.area[data-trend="up"] { fill: rgba(0, 186, 124, 0.12); }
.area[data-trend="down"] { fill: rgba(249, 24, 128, 0.12); }
.area[data-trend="flat"] { fill: rgba(113, 118, 123, 0.12); }
.bar { display: grid; gap: 4px; align-content: center; height: 100%; }
.bar-track { display: flex; height: 8px; border-radius: 999px; overflow: hidden; background: rgb(47, 51, 54); }
.bar-yes { background: rgb(0, 186, 124); }
.bar-no { background: rgb(249, 24, 128); flex: 1; }
.bar-labels { display: flex; justify-content: space-between; font-size: 11px; line-height: 12px; color: rgb(113, 118, 123); }
.why { display: flex; gap: 8px; align-items: flex-start; color: rgb(231, 233, 234); }
.badge {
  flex: none; padding: 0 8px; border-radius: 999px; font-size: 12px; font-weight: 700; line-height: 20px;
  background: rgb(239, 243, 244); color: rgb(15, 20, 25);
}
.badge[data-source="keywords"] { background: rgb(47, 51, 54); color: rgb(231, 233, 234); }
.why-text { min-width: 0; }
.trade { display: grid; gap: 8px; }
.chips { display: flex; gap: 8px; }
button, a.link { font: inherit; }
.chip {
  flex: 1; height: 32px; border-radius: 999px; border: 1px solid rgb(83, 100, 113); background: transparent;
  color: rgb(231, 233, 234); font-weight: 700; cursor: pointer;
}
.chip[aria-pressed="true"] { background: rgb(239, 243, 244); color: rgb(15, 20, 25); border-color: rgb(239, 243, 244); }
.buys { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.buy {
  height: 40px; border-radius: 999px; border: 0; font-weight: 700; color: #fff; cursor: pointer;
}
.buy[data-outcome="yes"] { background: rgb(0, 186, 124); }
.buy[data-outcome="no"] { background: rgb(249, 24, 128); }
.chip:disabled, .buy:disabled, .approve:disabled { opacity: 0.5; cursor: not-allowed; }
button:focus-visible, a.link:focus-visible { outline: 2px solid rgb(29, 155, 240); outline-offset: 2px; }
.blocked { color: rgb(113, 118, 123); font-size: 13px; line-height: 16px; }
.result { border-radius: 12px; padding: 8px 12px; font-size: 14px; line-height: 18px; display: grid; gap: 6px; }
.result[data-tone="filled"] { background: rgba(0, 186, 124, 0.12); color: rgb(0, 186, 124); }
.result[data-tone="approval"] { background: rgba(255, 173, 31, 0.12); color: rgb(255, 173, 31); }
.result[data-tone="refused"] { background: rgba(249, 24, 128, 0.12); color: rgb(249, 24, 128); }
.result[data-tone="quiet"], .result[data-tone="pending"] { background: rgba(113, 118, 123, 0.12); color: rgb(139, 152, 165); }
.result-title { font-weight: 700; }
.result-detail { color: rgb(231, 233, 234); }
.link { color: rgb(29, 155, 240); text-decoration: none; font-weight: 700; }
.link:hover { text-decoration: underline; }
.approve {
  justify-self: start; height: 32px; padding: 0 16px; border-radius: 999px; border: 0;
  background: rgb(255, 173, 31); color: rgb(15, 20, 25); font-weight: 700; cursor: pointer;
}
.foot {
  padding: 8px 16px; text-align: center; font-size: 14px; color: rgb(139, 152, 165);
  background: rgba(0, 0, 0, 0.35); border-top: 1px solid rgb(47, 51, 54);
}
.foot strong { color: rgb(231, 233, 234); }
@media (max-width: 420px) {
  .head { grid-template-columns: 44px minmax(0, 1fr); }
  .chart { grid-column: 1 / -1; width: 100%; }
}
@media (prefers-reduced-motion: no-preference) {
  .buy, .chip { transition: filter 120ms ease; }
  .buy:hover:not(:disabled), .chip:hover:not(:disabled) { filter: brightness(1.12); }
}
`;
