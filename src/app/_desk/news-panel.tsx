"use client";

import { useState } from "react";
import type { NewsView } from "@/shared";
import { formatClock } from "./format";
import styles from "./desk.module.css";

export const DEMO_HEADLINE = "Fed officials signal they could hold rates steady at the December FOMC meeting, Powell says";

interface NewsPanelProps {
  readonly news: NewsView | null;
  readonly busy: boolean;
  readonly onSubmit: (text: string) => void;
}

export function NewsPanel({ news, busy, onSubmit }: NewsPanelProps) {
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  return (
    <section className={styles.panel} aria-labelledby="news-heading">
      <h2 id="news-heading" className={styles.panelTitle}>News</h2>
      {news ? (
        <article className={styles.newsCard}>
          <p className={styles.headline}>{news.text}</p>
          <p className={styles.meta}>
            <span>{news.sourceDomain ?? "no source link"}</span>
            {news.author ? <span>{news.author}</span> : null}
            <span>{formatClock(news.postedAt)}</span>
          </p>
        </article>
      ) : (
        <p className={styles.empty}>No news yet. Paste a headline below or use the demo headline.</p>
      )}
      <form
        className={styles.newsForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <label className={styles.fieldLabel} htmlFor="news-text">Headline</label>
        <textarea
          id="news-text"
          className={styles.textarea}
          rows={2}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          placeholder="Paste a headline to match it to a market"
        />
        <div className={styles.row}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setDraft(DEMO_HEADLINE);
            }}
          >
            Use demo headline
          </button>
          <button type="submit" className={styles.primaryButton} disabled={busy || trimmed === ""}>
            Match to market
          </button>
        </div>
      </form>
    </section>
  );
}
