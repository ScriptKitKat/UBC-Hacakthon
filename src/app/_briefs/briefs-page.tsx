"use client";

import Link from "next/link";
import { useState } from "react";
import {
  authorLabel,
  authorLine,
  filterLibraryItems,
  leftoverBriefSections,
  librarySectionGroups,
  oddsDeltaPoints,
} from "@/shared";
import type { BriefEvidence, BriefLibraryFilter, BriefLibraryItem, BriefLibraryView, BriefResolution } from "@/shared";
import { usePolling } from "../_desk/use-polling";
import { purchaseDeepDive } from "../_research/api";
import { formatDollarsFromCents } from "../_research/format";
import { loadBriefLibrary } from "./api";
import type { BriefLibraryResult } from "./api";
import { PageHero } from "../_shell/page-hero";
import styles from "./briefs.module.css";

const POLL_MS = 15_000;
const ZONE = "America/Chicago";

const FILTERS: readonly { readonly id: BriefLibraryFilter; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "agents", label: "By agents" },
  { id: "refresh", label: "Needs refresh" },
  { id: "resolved", label: "Resolved" },
];

function formatDate(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (Number.isNaN(ms)) return typeof isoOrMs === "string" ? isoOrMs : "";
  return new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" }).format(new Date(ms));
}

function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatOdds(cents: number | null): string {
  return cents === null ? "—" : `${String(Math.round(cents))}%`;
}

function resolvedLabel(resolved: BriefResolution): string {
  if (resolved === "yes") return "Resolved YES";
  if (resolved === "no") return "Resolved NO";
  return "Resolved";
}

function statusLabel(item: BriefLibraryItem): { readonly text: string; readonly className: string } | null {
  if (item.resolved !== null) return { text: resolvedLabel(item.resolved), className: styles.badgeResolved ?? "" };
  if (item.needsRefresh) return { text: "Needs refresh", className: styles.badgeRefresh ?? "" };
  if (item.yesCentsNow !== null) return { text: "Up to date", className: styles.badgeOk ?? "" };
  return null;
}

function oddsLine(item: BriefLibraryItem): string {
  if (item.resolved === "yes" || item.resolved === "no") {
    return `${formatOdds(item.yesCentsWhenWritten)} → ${item.resolved === "yes" ? "YES" : "NO"}`;
  }
  return `${formatOdds(item.yesCentsWhenWritten)} → ${formatOdds(item.yesCentsNow)}`;
}

function statsLine(stats: BriefLibraryView["stats"]): string {
  const briefs = `${String(stats.count)} brief${stats.count === 1 ? "" : "s"}`;
  return `${briefs} · ${formatDollarsFromCents(stats.spentCents)} spent · ${String(stats.writtenByAgents)} written by agents`;
}

function staleCopy(item: BriefLibraryItem): string | null {
  const delta = oddsDeltaPoints(item.yesCentsWhenWritten, item.yesCentsNow);
  if (delta === null || !item.needsRefresh) return null;
  const points = Math.abs(delta);
  return `Odds moved ${String(points)} point${points === 1 ? "" : "s"} since this was written. This brief is a snapshot, not a live take.`;
}

export function BriefsPage() {
  const [result, setResult] = useState<BriefLibraryResult | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BriefLibraryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  usePolling(() => {
    void loadBriefLibrary().then(setResult);
  }, POLL_MS);

  const items = result?.kind === "ready" ? result.view.items : [];
  const visible = filterLibraryItems(items, filter, query);
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;

  async function refresh(item: BriefLibraryItem): Promise<void> {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshNote(null);
    const purchase = await purchaseDeepDive(item.symbol);
    setRefreshing(false);
    if (purchase.kind === "error") {
      setRefreshNote(purchase.message);
      return;
    }
    if (purchase.result.status === "delivered") {
      setRefreshNote(purchase.result.alreadyPurchased ? "Reused the brief already bought in the last 15 minutes." : "A new brief is in your library.");
      const next = await loadBriefLibrary();
      setResult(next);
      return;
    }
    setRefreshNote(purchase.result.failureReason ?? "The desk could not refresh this brief.");
  }

  return (
    <div className={styles.page}>
      <PageHero
        title="Briefs"
        lead={result?.kind === "ready" ? statsLine(result.view.stats) : "Research reports you can read before deciding on a market"}
      >
        <input
          className={styles.search}
          type="search"
          value={query}
          placeholder="Search your briefs"
          aria-label="Search your briefs"
          onChange={(event) => { setQuery(event.target.value); }}
        />
      </PageHero>

      <div className={styles.filters} role="toolbar" aria-label="Filter briefs">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={styles.pill}
            aria-pressed={filter === entry.id}
            onClick={() => { setFilter(entry.id); }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {result === null ? <p className={styles.status}>Loading purchased briefs…</p> : null}
      {result?.kind === "not-configured" ? <p className={styles.status}>The desk is not configured, so there are no purchased briefs to show.</p> : null}
      {result?.kind === "error" ? <p className={styles.error} role="alert">{result.message}</p> : null}

      {result?.kind === "ready" && items.length === 0 ? (
        <div className={styles.emptyCard}>
          <h2>No briefs yet</h2>
          <p>A brief is a research report on one market: what could push it up or down, and what to watch. Each one costs $0.05 from a market page, and is saved here with its Solana receipt.</p>
          <Link className={styles.emptyLink} href="/markets">Find a market to research</Link>
        </div>
      ) : null}

      {result?.kind === "ready" && items.length > 0 && visible.length === 0 ? (
        <p className={styles.empty}>No briefs match this filter.</p>
      ) : null}

      {result?.kind === "ready" && visible.length > 0 ? (
        <div className={styles.body}>
          <div className={styles.list} role="list">
            {visible.map((item) => {
              const badge = statusLabel(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={styles.row}
                  role="listitem"
                  aria-current={selected?.id === item.id}
                  onClick={() => { setSelectedId(item.id); }}
                >
                  <div className={styles.rowMeta}>
                    <span>{item.category} · {formatDate(item.writtenAt)}</span>
                    {badge !== null ? <span className={badge.className}>{badge.text}</span> : null}
                  </div>
                  <div className={styles.rowTitle}>{item.title}</div>
                  <div className={styles.rowOdds}>{oddsLine(item)}</div>
                  <div className={styles.rowBy}>by {authorLabel(item.author)}</div>
                </button>
              );
            })}
          </div>
          {selected !== null ? (
            <BriefDetail
              item={selected}
              refreshing={refreshing}
              refreshNote={refreshNote}
              onRefresh={() => { void refresh(selected); }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function sectionHeading(group: ReturnType<typeof librarySectionGroups>[number]): string | undefined {
  if (group.id === "cases") return "Case for YES / NO";
  if (group.id === "upcoming") return "Coming up before it resolves";
  return group.sections[0]?.title;
}

function BriefDetail(props: {
  readonly item: BriefLibraryItem;
  readonly refreshing: boolean;
  readonly refreshNote: string | null;
  readonly onRefresh: () => void;
}) {
  const { item } = props;
  const evidence = item.brief.evidence;
  const warning = staleCopy(item);
  const groups = librarySectionGroups(item.brief);
  const leftover = leftoverBriefSections(item.brief);

  return (
    <article className={styles.detail}>
      <div>
        <h2 className={styles.detailTitle}>{item.title}</h2>
        <p className={styles.author}>{authorLine(item.author)}</p>
        <p className={styles.written}>
          {item.category} · Written {formatDate(item.writtenAt)} · {formatDollarsFromCents(item.costCents)} USDC
        </p>
        {item.explorerUrl !== null && item.explorerUrl !== "" ? (
          <a className={styles.receipt} href={item.explorerUrl} target="_blank" rel="noopener noreferrer">
            Receipt on Solana Explorer
          </a>
        ) : null}
        <div>
          <Link className={styles.marketLink} href={`/markets/${encodeURIComponent(item.symbol)}`}>Open market</Link>
        </div>
      </div>

      {warning !== null ? (
        <div className={styles.banner}>
          <span>{warning}</span>
          <button type="button" className={styles.refresh} disabled={props.refreshing} onClick={props.onRefresh}>
            {props.refreshing ? "Refreshing…" : "Refresh · $0.05"}
          </button>
        </div>
      ) : null}
      {props.refreshNote !== null ? <p className={styles.refreshNote}>{props.refreshNote}</p> : null}

      {evidence?.bottomLine !== undefined ? (
        <div className={styles.bottom}>
          <p className={styles.bottomLabel}>Bottom line</p>
          <p>{evidence.bottomLine}</p>
        </div>
      ) : null}

      <MetricTiles item={item} evidence={evidence} />

      {groups.map((group, index) => (
        <section key={group.id} className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.sectionNum}>{index + 1}</span>
            {sectionHeading(group)}
          </h3>
          {group.id === "cases" ? (
            <div className={styles.cases}>
              {group.sections.map((section) => (
                <div key={section.title} className={styles.case}>
                  <p className={styles.caseTitle}>{section.title}</p>
                  <p className={styles.prose}>{section.body}</p>
                </div>
              ))}
            </div>
          ) : (
            <SectionBody groupId={group.id} evidence={evidence} fallback={group.sections.map((section) => section.body).join("\n\n")} />
          )}
        </section>
      ))}

      {leftover.map((section) => (
        <section key={section.title} className={styles.section}>
          <h3 className={styles.sectionTitle}>{section.title}</h3>
          <p className={styles.prose}>{section.body}</p>
        </section>
      ))}
    </article>
  );
}

function MetricTiles(props: { readonly item: BriefLibraryItem; readonly evidence: BriefEvidence | undefined }) {
  const estimate = props.evidence?.estimateCents;
  const confidence = props.evidence?.confidence;
  const tiles: { readonly label: string; readonly value: string }[] = [
    { label: "Market when written", value: formatOdds(props.item.yesCentsWhenWritten) },
    { label: "Market now", value: props.item.resolved === "yes" || props.item.resolved === "no" ? (props.item.resolved === "yes" ? "YES" : "NO") : formatOdds(props.item.yesCentsNow) },
  ];
  if (estimate !== undefined && estimate !== null) tiles.push({ label: "Agent's estimate", value: formatOdds(estimate) });
  if (confidence !== undefined && confidence !== null) tiles.push({ label: "Confidence", value: confidence });
  return (
    <div className={styles.tiles}>
      {tiles.map((tile) => (
        <div key={tile.label} className={styles.tile}>
          <p className={styles.tileLabel}>{tile.label}</p>
          <p className={styles.tileValue}>{tile.value}</p>
        </div>
      ))}
    </div>
  );
}

function SectionBody(props: {
  readonly groupId: string;
  readonly evidence: BriefEvidence | undefined;
  readonly fallback: string;
}) {
  const evidence = props.evidence;
  if (props.groupId === "resolves" && evidence?.resolution !== undefined) {
    const { yesIf, decidedBy, caveat } = evidence.resolution;
    const facts = [
      yesIf === null ? null : { label: "YES if", value: yesIf },
      decidedBy === null ? null : { label: "Decided by", value: decidedBy },
      caveat === null ? null : { label: "Watch out for", value: caveat },
    ].filter((fact) => fact !== null);
    if (facts.length > 0) {
      return (
        <div className={styles.facts}>
          {facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <span className={styles.factLabel}>{fact.label}</span>
              <span className={styles.factValue}>{fact.value}</span>
            </div>
          ))}
        </div>
      );
    }
  }
  if (props.groupId === "numbers" && evidence?.keyNumbers !== undefined && evidence.keyNumbers.length > 0) {
    return (
      <div className={styles.numbers}>
        {evidence.keyNumbers.map((row) => (
          <div key={row.label} className={styles.number}>
            <p className={styles.numberLabel}>{row.label}</p>
            <p className={styles.numberValue}>{row.value}</p>
          </div>
        ))}
      </div>
    );
  }
  if (props.groupId === "moved" && evidence?.moves !== undefined && evidence.moves.length > 0) {
    return (
      <div className={styles.moves}>
        {evidence.moves.map((row) => (
          <div key={`${String(row.atMs)}-${String(row.points)}`} className={styles.move}>
            <p className={styles.moveWhen}>
              {formatDate(row.atMs)} · <span className={[styles.movePts, row.points >= 0 ? styles.up : styles.down].filter((name) => name !== undefined).join(" ")}>{row.points > 0 ? "+" : ""}{String(row.points)}</span>
            </p>
            <p className={styles.moveNote}>{row.note}</p>
          </div>
        ))}
      </div>
    );
  }
  if (props.groupId === "upcoming" && evidence?.upcoming !== undefined && evidence.upcoming.length > 0) {
    return (
      <div className={styles.events}>
        {evidence.upcoming.map((row) => (
          <div key={`${String(row.atMs)}-${row.label}`} className={styles.event}>
            <p className={styles.eventWhen}>{formatDateTime(row.atMs)} <span className={styles.importance}>{row.importance}</span></p>
            <p className={styles.eventLabel}>{row.label}</p>
          </div>
        ))}
      </div>
    );
  }
  if (props.groupId === "crowd" && evidence?.crowd !== undefined && evidence.crowd.length > 0) {
    return (
      <div className={styles.crowd}>
        {evidence.crowd.map((row) => (
          <div key={row.label} className={styles.number}>
            <p className={styles.numberLabel}>{row.label}</p>
            <p className={styles.numberValue}>{row.value}</p>
          </div>
        ))}
      </div>
    );
  }
  if (props.groupId === "sources" && evidence?.sources !== undefined && evidence.sources.length > 0) {
    return (
      <div className={styles.sources}>
        {evidence.sources.map((source) => (
          <a key={source.url} className={styles.receipt} href={source.url} target="_blank" rel="noopener noreferrer">
            {source.title}
          </a>
        ))}
      </div>
    );
  }
  return <p className={styles.prose}>{props.fallback}</p>;
}
