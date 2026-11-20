import type { SpendEntry } from "@/features/journal";
import type { PriceSnapshot } from "@/features/history";
import type { Candle } from "@/features/markets";
import type { Outcome, PortfolioActivity, PortfolioRange, PortfolioView } from "@/shared";
import { aggregatePositions, fillsFromJournal } from "./positions";
import type { MarketMark } from "./positions";

export const MIN_CALIBRATION_BETS = 5;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const SPEND_CHART_MAX_DAYS = 14;

const CENTS_PER_DOLLAR = 100;
const CST = "America/Chicago";

export interface PortfolioMarket extends MarketMark {
  readonly category: string;
  readonly expiryDate: string | null;
}

export interface PortfolioInputs {
  readonly entries: readonly SpendEntry[];
  readonly markets: ReadonlyMap<string, PortfolioMarket>;
  readonly history: ReadonlyMap<string, readonly PriceSnapshot[]>;
  readonly candles: ReadonlyMap<string, readonly Candle[]>;
  readonly dailyCapCents: number;
  readonly range: PortfolioRange;
  readonly nowMs: number;
}

export function policyDayUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function policyDayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

export function formatPolicyDayLabel(day: string): string {
  const startMs = policyDayStartMs(day);
  return new Intl.DateTimeFormat("en-US", { timeZone: CST, month: "short", day: "numeric" }).format(startMs);
}

export function formatPolicyReset(nowMs: number): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: CST, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(policyDayStartMs(policyDayUtc(nowMs)));
  return `Days reset at ${time}.`;
}

export function formatRangeDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: CST, month: "short", day: "numeric" }).format(ms);
}

export function formatExpiry(expiryDate: string | null): string | null {
  if (expiryDate === null) return null;
  const ms = Date.parse(expiryDate);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: CST, month: "short", day: "numeric" }).format(ms);
}

export function parsePortfolioRange(value: string | null | undefined): PortfolioRange {
  if (value === "7d" || value === "30d" || value === "90d" || value === "all") return value;
  return "30d";
}

export function rangeWindow(range: PortfolioRange, nowMs: number, earliestMs: number | null): { readonly startMs: number; readonly endMs: number } {
  if (range === "7d") return { startMs: nowMs - 7 * DAY_MS, endMs: nowMs };
  if (range === "30d") return { startMs: nowMs - 30 * DAY_MS, endMs: nowMs };
  if (range === "90d") return { startMs: nowMs - 90 * DAY_MS, endMs: nowMs };
  const start = earliestMs === null ? nowMs : Math.min(earliestMs, nowMs);
  return { startMs: start, endMs: nowMs };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function entryTimeMs(entry: SpendEntry): number {
  return Date.parse(entry.resolvedAt ?? entry.reservedAt);
}

function placedBy(senderId: string): string {
  const trimmed = senderId.trim();
  if (trimmed === "" || trimmed === "priscilla") return "You";
  return trimmed;
}

function isSettled(entry: SpendEntry): boolean {
  return entry.status === "settled";
}

type MarkSource = "history" | "candle" | "carried" | "live";

function sideMark(yesCents: number, outcome: Outcome): number {
  return outcome === "yes" ? yesCents : round(Math.max(0, 100 - yesCents), 2);
}

function markAt(
  symbol: string,
  outcome: Outcome,
  atMs: number,
  history: ReadonlyMap<string, readonly PriceSnapshot[]>,
  candles: ReadonlyMap<string, readonly Candle[]>,
  live: PortfolioMarket | undefined,
  nowMs: number,
): { readonly cents: number; readonly source: MarkSource } | null {
  const points = history.get(symbol) ?? [];
  let bestHistory: PriceSnapshot | undefined;
  for (const point of points) {
    if (point.atMs <= atMs && (bestHistory === undefined || point.atMs > bestHistory.atMs)) bestHistory = point;
  }
  const historyMark = bestHistory === undefined ? null : sideMark(bestHistory.bidCents ?? bestHistory.yesCents, outcome);
  const bars = candles.get(symbol) ?? [];
  let bestCandle: Candle | undefined;
  for (const bar of bars) {
    if (bar.timeMs <= atMs && (bestCandle === undefined || bar.timeMs > bestCandle.timeMs)) bestCandle = bar;
  }
  const liveCents = live === undefined ? null : (outcome === "yes" ? live.yesCents : live.noCents);
  const today = policyDayUtc(atMs) === policyDayUtc(nowMs);
  if (today && liveCents !== null) return { cents: liveCents, source: "live" };
  const historyMs = bestHistory?.atMs ?? -1;
  const candleMs = bestCandle?.timeMs ?? -1;
  if (historyMark !== null && historyMs >= candleMs) return { cents: historyMark, source: "history" };
  if (bestCandle !== undefined) return { cents: sideMark(bestCandle.closeCents, outcome), source: "candle" };
  if (liveCents !== null) return { cents: liveCents, source: "carried" };
  return null;
}

interface BucketSpec {
  readonly min: number;
  readonly max: number;
  readonly label: string;
}

const BUCKETS: readonly BucketSpec[] = [
  { min: 0, max: 20, label: "Paid 0–20¢" },
  { min: 20, max: 40, label: "Paid 20–40¢" },
  { min: 40, max: 60, label: "Paid 40–60¢" },
  { min: 60, max: 80, label: "Paid 60–80¢" },
  { min: 80, max: 100.0001, label: "Paid 80–100¢" },
];
function categoryCaption(rows: readonly { readonly category: string; readonly pnlCents: number }[]): string | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) {
    const [only] = rows;
    if (only === undefined) return null;
    if (only.pnlCents > 0) return `${only.category} is your only category with a gain so far.`;
    if (only.pnlCents < 0) return `${only.category} is your only category, and it is at a loss.`;
    return `${only.category} is your only category, currently flat.`;
  }
  const ranked = [...rows].sort((a, b) => b.pnlCents - a.pnlCents);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (best === undefined || worst === undefined) return null;
  if (best.pnlCents > 0 && worst.pnlCents < 0) return `${best.category} drives most of your gains. ${worst.category} is your weakest category.`;
  if (best.pnlCents > 0) return `${best.category} drives most of your gains.`;
  if (worst.pnlCents < 0) return `${worst.category} is your weakest category.`;
  return null;
}

function spendCaption(
  days: readonly { readonly day: string; readonly betsCents: number; readonly briefsCents: number }[],
  dailyCapCents: number,
): string {
  let busiest = days[0];
  if (busiest === undefined) return "No spend in this window";
  for (const day of days) {
    if (day.betsCents + day.briefsCents > busiest.betsCents + busiest.briefsCents) busiest = day;
  }
  const peak = busiest.betsCents + busiest.briefsCents;
  if (peak === 0) return "No spend in this window";
  const hit = days.filter((day) => day.betsCents + day.briefsCents >= dailyCapCents);
  const peakLabel = formatPolicyDayLabel(busiest.day);
  const peakText = `Busiest day: $${(peak / CENTS_PER_DOLLAR).toFixed(2)} on ${peakLabel}`;
  if (hit.length === 0) return `${peakText} · never hit the cap`;
  if (hit.length === 1 && hit[0] !== undefined) return `${peakText} · hit the cap on ${formatPolicyDayLabel(hit[0].day)}`;
  return `${peakText} · hit the cap on ${String(hit.length)} days`;
}

function eachPolicyDay(startMs: number, endMs: number): string[] {
  const first = policyDayUtc(startMs);
  const last = policyDayUtc(endMs);
  const days: string[] = [];
  for (let ms = policyDayStartMs(first); policyDayUtc(ms) <= last && days.length < 400; ms += DAY_MS) {
    days.push(policyDayUtc(ms));
  }
  return days;
}

export function activityCsv(rows: readonly PortfolioActivity[]): string {
  const header = ["When", "Type", "Market", "Symbol", "Side", "By", "Detail", "Amount USD", "Ticket", "Signature", "Explorer"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([
      row.at,
      row.type,
      row.market,
      row.symbol,
      row.side ?? "",
      row.placedBy,
      row.detail,
      (row.amountCents / CENTS_PER_DOLLAR).toFixed(2),
      row.ticketId ?? "",
      row.signature ?? "",
      row.explorerUrl ?? "",
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value: string): string {
  if (/[",\n\r]/u.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

export function buildPortfolio(input: PortfolioInputs): PortfolioView {
  const { entries, markets, history, candles, dailyCapCents, range, nowMs } = input;
  const settled = entries.filter(isSettled);
  const times = settled.map(entryTimeMs).filter((ms) => Number.isFinite(ms));
  const earliest = times.length === 0 ? null : Math.min(...times);
  const window = rangeWindow(range, nowMs, earliest);
  const inRange = (ms: number) => ms >= window.startMs && ms <= window.endMs;
  const ranged = settled.filter((entry) => inRange(entryTimeMs(entry)));
  const fills = fillsFromJournal(settled);
  const generatedAt = new Date(nowMs).toISOString();
  const allPositions = aggregatePositions(fills, markets, generatedAt).positions;
  const openRows = allPositions.filter((position) => position.status === "open" || position.status === "closed" || position.status === "unavailable");
  const settledPositions = allPositions.filter((position) => position.status === "settled");
  const settledInRange = settledPositions.filter((position) => {
    const opened = Date.parse(position.fills[0]?.at ?? "");
    const market = markets.get(position.symbol);
    const expiryMs = market?.expiryDate ? Date.parse(market.expiryDate) : NaN;
    const settledAt = Number.isFinite(expiryMs) ? expiryMs : opened;
    return inRange(opened) || inRange(settledAt);
  });

  const realizedPnlCents = round(settledInRange.reduce((sum, position) => {
    const value = position.valueCents ?? 0;
    return sum + (value - position.costCents);
  }, 0), 2);
  const settledWins = settledInRange.filter((position) => position.currentCents === 100);
  const openPriced = openRows.filter((position) => position.valueCents !== null);
  const openValueCents = round(openPriced.reduce((sum, position) => sum + (position.valueCents ?? 0), 0), 2);
  const openCostCents = openPriced.reduce((sum, position) => sum + position.costCents, 0);
  const openPnlCents = round(openValueCents - openCostCents, 2);
  const totalPnlCents = round(realizedPnlCents + openPnlCents, 2);
  const researchEntries = ranged.filter((entry) => entry.kind === "research");
  const researchCents = researchEntries.reduce((sum, entry) => sum + entry.notionalCents, 0);
  const rangedTradeCost = ranged.filter((entry) => entry.kind === "trade").reduce((sum, entry) => sum + entry.notionalCents, 0);
  const stakedCents = rangedTradeCost + openRows.filter((position) => {
    const opened = Date.parse(position.fills[0]?.at ?? "");
    return Number.isFinite(opened) && opened < window.startMs;
  }).reduce((sum, position) => sum + position.costCents, 0);
  const returnPercent = stakedCents === 0 ? null : round((totalPnlCents / stakedCents) * 100, 1);
  const winPercent = settledInRange.length === 0 ? null : round((settledWins.length / settledInRange.length) * 100, 0);

  const policyDays = eachPolicyDay(window.startMs, window.endMs);
  const pnlSeries = policyDays.map((day) => {
    const dayEnd = Math.min(policyDayStartMs(day) + DAY_MS - 1, nowMs);
    let realized = 0;
    let open = 0;
    let dayCarried = false;
    for (const position of allPositions) {
      const first = Date.parse(position.fills[0]?.at ?? "");
      if (!Number.isFinite(first) || first > dayEnd) continue;
      const cost = position.costCents;
      const market = markets.get(position.symbol);
      const expiryMs = market?.expiryDate ? Date.parse(market.expiryDate) : NaN;
      const settledAt = position.status === "settled" ? (Number.isFinite(expiryMs) ? expiryMs : first) : null;
      if (settledAt !== null && settledAt <= dayEnd) {
        realized += (position.valueCents ?? 0) - cost;
        continue;
      }
      const marked = markAt(position.symbol, position.outcome, dayEnd, history, candles, market, nowMs);
      if (marked === null) continue;
      if (marked.source === "carried") dayCarried = true;
      open += marked.cents * position.contracts - cost;
    }
    const researchSpendCents = settled
      .filter((entry) => entry.kind === "research" && entryTimeMs(entry) <= dayEnd)
      .reduce((sum, entry) => sum + entry.notionalCents, 0);
    return {
      at: new Date(dayEnd).toISOString(),
      label: day === policyDayUtc(nowMs) ? "Today" : formatPolicyDayLabel(day),
      totalPnlCents: round(realized + open, 2),
      researchSpendCents,
      carried: dayCarried,
    };
  });

  const spendDaysAll = policyDays.map((day) => {
    const start = policyDayStartMs(day);
    const end = start + DAY_MS;
    const dayEntries = ranged.filter((entry) => {
      const ms = entryTimeMs(entry);
      return ms >= start && ms < end;
    });
    return {
      day,
      label: formatPolicyDayLabel(day),
      betsCents: dayEntries.filter((entry) => entry.kind === "trade").reduce((sum, entry) => sum + entry.notionalCents, 0),
      briefsCents: dayEntries.filter((entry) => entry.kind === "research").reduce((sum, entry) => sum + entry.notionalCents, 0),
    };
  });
  const spendDays = spendDaysAll.slice(-SPEND_CHART_MAX_DAYS);
  const windowLabel = `last ${String(spendDays.length)} days`;

  const categoryTotals = new Map<string, number>();
  for (const position of [...openRows, ...settledInRange]) {
    const market = markets.get(position.symbol);
    const category = market?.category.trim() || "Uncategorized";
    const pnl = position.pnlCents ?? 0;
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + pnl);
  }
  const categoryRows = [...categoryTotals.entries()]
    .map(([category, pnlCents]) => ({ category, pnlCents: round(pnlCents, 2) }))
    .sort((a, b) => Math.abs(b.pnlCents) - Math.abs(a.pnlCents));

  const calibrationBets = settledInRange.map((position) => ({
    priceCents: position.averageEntryCents,
    won: position.currentCents === 100,
  }));
  const calibrationEmpty = calibrationBets.length < MIN_CALIBRATION_BETS
    ? `Need at least ${String(MIN_CALIBRATION_BETS)} settled bets to chart how well you price odds. ${calibrationBets.length === 0 ? "None have settled yet." : `Only ${String(calibrationBets.length)} ${calibrationBets.length === 1 ? "has" : "have"} settled so far.`}`
    : null;
  const buckets = calibrationEmpty === null
    ? BUCKETS.flatMap((spec) => {
        const inBucket = calibrationBets.filter((bet) => bet.priceCents >= spec.min && bet.priceCents < spec.max);
        if (inBucket.length === 0) return [];
        const wins = inBucket.filter((bet) => bet.won).length;
        const implied = inBucket.reduce((sum, bet) => sum + bet.priceCents, 0) / inBucket.length;
        return [{
          label: spec.label,
          bets: inBucket.length,
          wins,
          winRatePercent: round((wins / inBucket.length) * 100, 0),
          impliedPercent: round(implied, 1),
        }];
      })
    : [];

  const activity: PortfolioActivity[] = [];
  for (const entry of ranged) {
    const market = markets.get(entry.symbol);
    const at = entry.resolvedAt ?? entry.reservedAt;
    const title = market?.eventTitle ?? entry.symbol;
    const ticket = entry.ticket ?? null;
    if (entry.kind === "research") {
      activity.push({
        id: entry.operationId,
        at,
        type: "brief",
        market: title,
        symbol: entry.symbol,
        side: entry.outcome,
        placedBy: placedBy(entry.senderId),
        detail: "One-off deep dive",
        amountCents: -entry.notionalCents,
        ticketId: ticket?.ticketId ?? null,
        ticket,
        signature: entry.signature ?? null,
        explorerUrl: entry.explorerUrl ?? null,
      });
      continue;
    }
    if (ticket !== null) {
      const quantity = ticket.quantity;
      const priceLabel = `${String(Math.round(Number(ticket.price) * CENTS_PER_DOLLAR))}¢`;
      activity.push({
        id: entry.operationId,
        at,
        type: "bet",
        market: title,
        symbol: entry.symbol,
        side: entry.outcome,
        placedBy: placedBy(entry.senderId),
        detail: `Bought ${quantity} ${ticket.outcome.toUpperCase()} at ${priceLabel}`,
        amountCents: -entry.notionalCents,
        ticketId: ticket.ticketId,
        ticket,
        signature: entry.signature ?? null,
        explorerUrl: entry.explorerUrl ?? null,
      });
    }
  }
  for (const position of settledInRange) {
    if (position.currentCents !== 100 || position.valueCents === null) continue;
    const market = markets.get(position.symbol);
    const expiryMs = market?.expiryDate ? Date.parse(market.expiryDate) : NaN;
    const at = Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : (position.fills.at(-1)?.at ?? generatedAt);
    if (!inRange(Date.parse(at))) continue;
    const fill = position.fills[0];
    activity.push({
      id: `payout:${position.symbol}:${position.outcome}`,
      at,
      type: "payout",
      market: market?.eventTitle ?? position.eventTitle ?? position.symbol,
      symbol: position.symbol,
      side: position.outcome,
      placedBy: "You",
      detail: `Resolved ${position.outcome.toUpperCase()} · your ${position.outcome.toUpperCase()} paid $1 a share`,
      amountCents: position.valueCents,
      ticketId: fill?.entryId ?? null,
      ticket: null,
      signature: fill?.signature ?? null,
      explorerUrl: fill?.explorerUrl ?? null,
    });
  }
  activity.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));

  const marksNote = pnlSeries.some((point) => point.carried)
    ? "Some days on the P/L chart use the last known mark because Gemini had no candle that day."
    : null;

  return {
    generatedAt,
    range,
    rangeStart: new Date(window.startMs).toISOString(),
    rangeEnd: new Date(window.endMs).toISOString(),
    dailyCapCents,
    marksNote,
    stats: {
      totalPnl: {
        valueCents: totalPnlCents,
        valuePercent: null,
        detail: "realized + open",
      },
      openValue: {
        valueCents: openValueCents,
        valuePercent: null,
        detail: `${String(openRows.length)} ${openRows.length === 1 ? "market" : "markets"} · cost $${(openRows.reduce((sum, position) => sum + position.costCents, 0) / CENTS_PER_DOLLAR).toFixed(2)}`,
      },
      realizedPnl: {
        valueCents: realizedPnlCents,
        valuePercent: null,
        detail: `${String(settledInRange.length)} resolved`,
      },
      winRate: {
        percent: winPercent,
        wins: settledWins.length,
        settled: settledInRange.length,
        detail: settledInRange.length === 0 ? "No settled bets yet" : `${String(settledWins.length)} of ${String(settledInRange.length)}`,
      },
      returnOnSpend: {
        percent: returnPercent,
        detail: "P/L ÷ total staked",
      },
      researchSpend: {
        valueCents: researchCents,
        valuePercent: null,
        detail: `${String(researchEntries.length)} ${researchEntries.length === 1 ? "brief" : "briefs"}`,
      },
    },
    pnlSeries,
    dailySpend: {
      days: spendDays,
      windowLabel,
      caption: spendCaption(spendDays, dailyCapCents),
      resetNote: formatPolicyReset(nowMs),
    },
    openPositions: {
      rows: openRows.map((position) => {
        const market = markets.get(position.symbol);
        return {
          symbol: position.symbol,
          eventTitle: market?.eventTitle ?? position.eventTitle ?? position.symbol,
          contractLabel: market?.contractLabel ?? position.contractLabel,
          outcome: position.outcome,
          placedBy: "You",
          shares: position.contracts,
          averageEntryCents: position.averageEntryCents,
          markCents: position.currentCents,
          valueCents: position.valueCents,
          pnlCents: position.pnlCents,
          ifRightCents: round(position.contracts * CENTS_PER_DOLLAR, 2),
          ends: formatExpiry(market?.expiryDate ?? null),
          markAgeSeconds: position.markAgeSeconds,
        };
      }),
      openCount: openRows.length,
      valueCents: openValueCents,
      unpriced: openRows.length - openPriced.length,
    },
    categories: {
      rows: categoryRows,
      caption: categoryCaption(categoryRows),
    },
    calibration: {
      settledBets: calibrationBets.length,
      empty: calibrationEmpty,
      buckets,
    },
    activity,
  };
}
