import type { SpendEntry } from "@/features/journal";
import type { MarketContract, MarketEvent } from "@/features/markets";
import type { Outcome, PositionStatus, PositionView, PositionsView, ResearchPurchaseView } from "@/shared";

export interface Fill {
  readonly entryId: string;
  readonly at: string;
  readonly symbol: string;
  readonly outcome: Outcome;
  readonly contracts: number;
  readonly costCents: number;
  readonly priceCents: number;
  readonly signature: string | null;
  readonly explorerUrl: string | null;
}

export interface MarketMark {
  readonly eventTitle: string;
  readonly contractLabel: string;
  readonly status: PositionStatus;
  readonly yesCents: number | null;
  readonly noCents: number | null;
  readonly markedAtMs: number;
}

const MARK_EXPIRY_MS = 10 * 60 * 1000;

const CENTS_PER_DOLLAR = 100;

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function fillsFromJournal(entries: readonly SpendEntry[]): readonly Fill[] {
  return entries.flatMap((entry): Fill[] => {
    const { ticket } = entry;
    if (entry.kind !== "trade" || entry.status !== "settled" || ticket === undefined || entry.outcome === null) return [];
    const contracts = Number(ticket.quantity);
    const priceCents = Number(ticket.price) * CENTS_PER_DOLLAR;
    if (!Number.isFinite(contracts) || contracts <= 0 || !Number.isFinite(priceCents) || priceCents <= 0) return [];
    return [
      {
        entryId: entry.operationId,
        at: entry.resolvedAt ?? entry.reservedAt,
        symbol: entry.symbol,
        outcome: entry.outcome,
        contracts,
        costCents: entry.notionalCents,
        priceCents: round(priceCents, 2),
        signature: entry.signature ?? null,
        explorerUrl: entry.explorerUrl ?? null,
      },
    ];
  });
}

function statusOf(event: MarketEvent, contract: MarketContract): PositionStatus {
  if (event.status === "settled" || contract.status === "settled") return "settled";
  return event.status === "active" && contract.marketState === "open" ? "open" : "closed";
}

export function markFromContract(event: MarketEvent, contract: MarketContract, markedAtMs: number): MarketMark {
  const status = statusOf(event, contract);
  const { sellYesCents, sellNoCents } = contract.prices;
  const base = { eventTitle: event.title, contractLabel: contract.label, status, markedAtMs };
  if (status === "settled") {
    if (contract.resolutionSide === undefined) return { ...base, yesCents: null, noCents: null };
    return { ...base, yesCents: contract.resolutionSide === "yes" ? 100 : 0, noCents: contract.resolutionSide === "no" ? 100 : 0 };
  }
  return { ...base, yesCents: sellYesCents, noCents: sellNoCents };
}

function groupKey(fill: Fill): string {
  return `${fill.symbol}|${fill.outcome}`;
}

function buildPosition(fills: readonly Fill[], mark: MarketMark | undefined, generatedAtMs: number): PositionView {
  const ordered = [...fills].sort((a, b) => a.at.localeCompare(b.at));
  const [first] = ordered;
  if (first === undefined) throw new Error("A position needs at least one fill");
  const contracts = ordered.reduce((sum, fill) => sum + fill.contracts, 0);
  const costCents = ordered.reduce((sum, fill) => sum + fill.costCents, 0);
  const entrySpend = ordered.reduce((sum, fill) => sum + fill.contracts * fill.priceCents, 0);
  const markAgeMs = mark === undefined ? null : Math.max(0, generatedAtMs - mark.markedAtMs);
  const expired = markAgeMs !== null && markAgeMs > MARK_EXPIRY_MS;
  const currentCents = mark === undefined || expired ? null : first.outcome === "yes" ? mark.yesCents : mark.noCents;
  const valueCents = currentCents === null ? null : round(contracts * currentCents, 2);
  const pnlCents = valueCents === null ? null : round(valueCents - costCents, 2);
  return {
    symbol: first.symbol,
    outcome: first.outcome,
    eventTitle: mark?.eventTitle ?? null,
    contractLabel: mark?.contractLabel ?? null,
    contracts: round(contracts, 2),
    averageEntryCents: round(entrySpend / contracts, 2),
    costCents,
    currentCents,
    markAgeSeconds: markAgeMs === null ? null : Math.floor(markAgeMs / 1000),
    valueCents,
    pnlCents,
    pnlPercent: pnlCents === null || costCents === 0 ? null : round((pnlCents / costCents) * 100, 2),
    status: mark?.status ?? "unavailable",
    fills: ordered.map((fill) => ({
      entryId: fill.entryId,
      at: fill.at,
      contracts: fill.contracts,
      costCents: fill.costCents,
      priceCents: fill.priceCents,
      signature: fill.signature,
      explorerUrl: fill.explorerUrl,
    })),
  };
}

export function aggregatePositions(fills: readonly Fill[], marks: ReadonlyMap<string, MarketMark>, generatedAt: string): Omit<PositionsView, "researchSpend"> {
  const groups = new Map<string, Fill[]>();
  for (const fill of fills) groups.set(groupKey(fill), [...(groups.get(groupKey(fill)) ?? []), fill]);
  const generatedAtMs = Date.parse(generatedAt);
  const positions = [...groups.values()]
    .map((group) => buildPosition(group, marks.get(group[0]?.symbol ?? ""), generatedAtMs))
    .sort((a, b) => (b.fills.at(-1)?.at ?? "").localeCompare(a.fills.at(-1)?.at ?? ""));
  const priced = positions.filter((position) => position.valueCents !== null);
  const pricedCostCents = priced.reduce((sum, position) => sum + position.costCents, 0);
  const valueCents = round(priced.reduce((sum, position) => sum + (position.valueCents ?? 0), 0), 2);
  const pnlCents = round(valueCents - pricedCostCents, 2);
  return {
    generatedAt,
    positions,
    totals: {
      costCents: positions.reduce((sum, position) => sum + position.costCents, 0),
      pricedCostCents,
      valueCents,
      pnlCents,
      pnlPercent: pricedCostCents === 0 ? null : round((pnlCents / pricedCostCents) * 100, 2),
      unpricedPositions: positions.length - priced.length,
    },
  };
}

const RESEARCH_PURCHASE_LIMIT = 20;

function paidResearch(entries: readonly SpendEntry[]): readonly SpendEntry[] {
  return entries
    .filter((entry) => entry.kind === "research" && entry.status === "settled")
    .sort((a, b) => (b.resolvedAt ?? b.reservedAt).localeCompare(a.resolvedAt ?? a.reservedAt));
}

export function todaysResearchSpendCents(entries: readonly SpendEntry[], day: string): number {
  return paidResearch(entries)
    .filter((entry) => (entry.resolvedAt ?? entry.reservedAt).slice(0, 10) === day)
    .reduce((total, entry) => total + entry.notionalCents, 0);
}

export function summarizeResearchSpend(entries: readonly SpendEntry[], nowIso: string): PositionsView["researchSpend"] {
  const purchases: ResearchPurchaseView[] = paidResearch(entries).slice(0, RESEARCH_PURCHASE_LIMIT).map((entry) => ({
    entryId: entry.operationId,
    at: entry.resolvedAt ?? entry.reservedAt,
    symbol: entry.symbol,
    costCents: entry.notionalCents,
    signature: entry.signature ?? null,
    explorerUrl: entry.explorerUrl ?? null,
  }));
  return { todayCents: todaysResearchSpendCents(entries, nowIso.slice(0, 10)), purchases };
}
