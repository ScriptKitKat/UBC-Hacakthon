import { createCard } from "../src/card-view";
import { market, matched } from "../src/fixtures";

const send = async () => ({ ok: false as const, error: "preview" });

const btc = {
  ...market,
  eventTicker: "BTC2611192200",
  eventTitle: "BTC price on November 19",
  contractLabel: "$61,750 or above",
  instrumentSymbol: "GEMI-BTC2611192200-T61750",
  expiryDate: "2026-11-19T22:00:00.000Z",
  geminiUrl: "https://www.gemini.com/predictions/BTC2611192200/btc-price-on-november-19?status=active",
  yesCents: 44,
  noCents: 59,
  impliedYesPercent: 44,
};

const card = createCard(
  { ...matched, market: btc, contracts: [btc, { ...btc, instrumentSymbol: "GEMI-BTC2611192200-T63000", contractLabel: "$63,000 or above", yesCents: 55, noCents: 48 }] },
  send,
  { researchHref: "http://localhost:3000/markets/GEMI-BTC2611192200-T61750", budget: { perTradeMaxCents: 1000, remainingCents: 1800, autoApproveMaxCents: 200 } },
);

document.getElementById("mount")?.append(card.host);
