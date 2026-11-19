import { createCard } from "../src/card-view";
import { market, matched } from "../src/fixtures";

const send = async () => ({ ok: false as const, error: "preview" });

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dim" ? "dim" : params.get("theme") === "dark" ? "dark" : "light";
const backgrounds = { light: "#FFFFFF", dark: "#000000", dim: "#15202B" } as const;
const foregrounds = { light: "#0f1419", dark: "#e7e9ea", dim: "#e7e9ea" } as const;
const muted = { light: "#536471", dark: "#71767b", dim: "#8b98a5" } as const;
const lines = { light: "#eff3f4", dark: "#2f3336", dim: "#38444d" } as const;
const bg = backgrounds[theme];
document.documentElement.style.backgroundColor = bg;
document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
document.body.style.backgroundColor = bg;
document.body.style.color = foregrounds[theme];
document.body.className = theme;
const tweet = document.getElementById("tweet");
if (tweet instanceof HTMLElement) {
  tweet.className = `tweet ${theme}`;
  tweet.style.backgroundColor = bg;
  tweet.style.color = foregrounds[theme];
  tweet.style.setProperty("--bg", bg);
  tweet.style.setProperty("--fg", foregrounds[theme]);
  tweet.style.setProperty("--muted", muted[theme]);
  tweet.style.setProperty("--line", lines[theme]);
}

const strike = (label: string, yesCents: number, noCents: number, symbol: string) => ({
  ...market,
  eventTicker: "BTC2611192200",
  eventTitle: "BTC price on November 19",
  contractLabel: label,
  instrumentSymbol: symbol,
  expiryDate: "2026-11-19T22:00:00.000Z",
  geminiUrl: "https://www.gemini.com/predictions/BTC2611192200/btc-price-on-november-19?status=active",
  yesCents,
  noCents,
  impliedYesPercent: yesCents,
});

const selected = strike("$61,750 or above", 44, 59, "GEMI-BTC2611192200-T61750");
const contracts = [
  strike("$59,000 or above", 72, 31, "GEMI-BTC2611192200-T59000"),
  strike("$60,000 or above", 60, 43, "GEMI-BTC2611192200-T60000"),
  selected,
  strike("$63,000 or above", 31, 72, "GEMI-BTC2611192200-T63000"),
];

const card = createCard(
  { ...matched, market: selected, contracts },
  send,
  { researchHref: "http://localhost:3000/markets/GEMI-BTC2611192200-T61750", budget: { perTradeMaxCents: 1000, remainingCents: 1800, autoApproveMaxCents: 200 } },
);

document.getElementById("mount")?.append(card.host);

const hours = (offset: number, yesCents: number) => ({
  at: new Date(Date.parse("2026-11-19T22:00:00.000Z") + offset * 3600_000).toISOString(),
  yesCents,
});
const rising = [hours(-24, 36), hours(-16, 38), hours(-8, 41), hours(-2, 43), hours(0, 44)];
const falling = [hours(-24, 56), hours(-16, 52), hours(-8, 48), hours(-2, 45), hours(0, 44)];
card.update({
  market: selected,
  contracts,
  history: theme === "dark" ? falling : rising,
});
