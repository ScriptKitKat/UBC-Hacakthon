"use client";

import { useState } from "react";
import type { XBotStatusView, XMessageView, XThreadView } from "@/shared";
import { loadXThreads, postX } from "./api";
import type { XThreadsResult } from "./api";
import { formatCents, formatClock, shortenMiddle } from "./format";
import { usePolling } from "./use-polling";
import styles from "./desk.module.css";

const POLL_INTERVAL_MS = 4000;
const DEMO_NEWS_HANDLE = "@reuters";

function avatarInitial(author: string): string {
  const letter = author.replace(/^@/u, "").charAt(0);
  return letter === "" ? "?" : letter.toUpperCase();
}

function Message({ message }: { readonly message: XMessageView }) {
  return (
    <li className={styles.xMessage} data-role={message.role} data-kind={message.decisionKind}>
      <span className={styles.xAvatar} aria-hidden="true">{avatarInitial(message.author)}</span>
      <div className={styles.xContent}>
        <p className={styles.xMessageHead}>
          <span className={styles.xAuthor}>{message.author}</span>
          <span>{formatClock(message.at)}</span>
          {message.postedToX ? <span>on X</span> : null}
          {message.postError ? <span className={styles.xError}>not posted: {message.postError}</span> : null}
        </p>
        <p className={styles.xText}>{message.text}</p>
        {message.ticketId || message.signature ? (
          <p className={styles.xProof}>
            {message.ticketId ? <span className={styles.ticket}>paper ticket {message.ticketId.slice(0, 8)}</span> : null}
            {message.signature && message.explorerUrl ? (
              <a className={styles.explorerLink} href={message.explorerUrl} target="_blank" rel="noreferrer" title={message.signature}>
                {shortenMiddle(message.signature, 8, 6)} ↗
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    </li>
  );
}

interface ReplyFormProps {
  readonly defaultHandle: string;
  readonly busy: boolean;
  readonly onReply: (authorHandle: string, text: string) => void;
}

function ReplyForm({ defaultHandle, busy, onReply }: ReplyFormProps) {
  const [handle, setHandle] = useState(defaultHandle);
  const [text, setText] = useState("");
  const trimmedHandle = handle.trim();
  const trimmedText = text.trim();
  return (
    <form
      className={styles.xReplyForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedHandle && trimmedText) {
          onReply(trimmedHandle, trimmedText);
          setText("");
        }
      }}
    >
      <div className={styles.amount}>
        <label className={styles.fieldLabel}>Handle</label>
        <input
          className={styles.input}
          value={handle}
          onChange={(event) => {
            setHandle(event.target.value);
          }}
        />
      </div>
      <div className={styles.amount}>
        <label className={styles.fieldLabel}>Reply in thread</label>
        <input
          className={styles.input}
          value={text}
          placeholder="yes 2"
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
      <button type="submit" className={styles.secondaryButton} disabled={busy || !trimmedHandle || !trimmedText}>
        Reply in thread
      </button>
    </form>
  );
}

function Thread({ thread, defaultHandle, busy, onReply }: {
  readonly thread: XThreadView;
  readonly defaultHandle: string;
  readonly busy: boolean;
  readonly onReply: (thread: XThreadView, authorHandle: string, text: string) => void;
}) {
  const { market } = thread;
  return (
    <article className={styles.xThread}>
      {market ? (
        <p className={styles.meta}>
          <span>{market.contractLabel}</span>
          <span>Yes {market.yesCents === null ? "—" : formatCents(market.yesCents)}</span>
          <span>No {market.noCents === null ? "—" : formatCents(market.noCents)}</span>
        </p>
      ) : (
        <p className={styles.meta}>No market matched</p>
      )}
      <ul className={styles.xMessages}>
        {thread.messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
      </ul>
      <ReplyForm
        defaultHandle={defaultHandle}
        busy={busy}
        onReply={(authorHandle, text) => {
          onReply(thread, authorHandle, text);
        }}
      />
    </article>
  );
}

function ModeBadge({ status }: { readonly status: XBotStatusView }) {
  return status.mode === "live" ? (
    <span className={styles.xBadgeLive}>Live X</span>
  ) : (
    <span className={styles.xBadgeFake} title={`Missing: ${status.configuredMissing.join(", ")}`}>
      Simulated thread — fake X client, nothing is posted to X
    </span>
  );
}

export function XThreadPanel({ senders }: { readonly senders: readonly string[] }) {
  const [result, setResult] = useState<XThreadsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newsText, setNewsText] = useState("");
  const [newsHandle, setNewsHandle] = useState(DEMO_NEWS_HANDLE);

  const refresh = () => {
    void loadXThreads().then(setResult);
  };
  usePolling(refresh, POLL_INTERVAL_MS);

  const run = (path: string, payload: unknown) => {
    setBusy(true);
    setActionError(null);
    void postX(path, payload)
      .then((outcome) => {
        if (!outcome.ok) setActionError(outcome.message);
        return loadXThreads();
      })
      .then(setResult)
      .finally(() => {
        setBusy(false);
      });
  };

  const trimmedNews = newsText.trim();
  const trimmedHandle = newsHandle.trim();
  return (
    <section className={styles.panelWide} aria-labelledby="x-heading">
      <div className={styles.xHeader}>
        <h2 id="x-heading" className={styles.panelTitle}>X thread</h2>
        {result?.kind === "ready" ? <ModeBadge status={result.status} /> : null}
      </div>
      {actionError ? <p className={styles.banner} role="alert">{actionError}</p> : null}
      <form
        className={styles.xNewsForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedNews && trimmedHandle) {
            run("news", { text: trimmedNews, authorHandle: trimmedHandle });
            setNewsText("");
          }
        }}
      >
        <div className={styles.amount}>
          <label className={styles.fieldLabel} htmlFor="x-news-handle">Author handle</label>
          <input
            id="x-news-handle"
            className={styles.input}
            value={newsHandle}
            onChange={(event) => {
              setNewsHandle(event.target.value);
            }}
          />
        </div>
        <div className={styles.amount}>
          <label className={styles.fieldLabel} htmlFor="x-news-text">Breaking news</label>
          <textarea
            id="x-news-text"
            className={styles.textarea}
            rows={2}
            value={newsText}
            onChange={(event) => {
              setNewsText(event.target.value);
            }}
            placeholder="Paste a news post to start a thread"
          />
        </div>
        <button type="submit" className={styles.primaryButton} disabled={busy || !trimmedNews || !trimmedHandle}>
          Post breaking news
        </button>
      </form>
      {result?.kind === "error" ? <p className={styles.warning}>{result.message}</p> : null}
      {result?.kind === "ready" && result.threads.length === 0 ? (
        <p className={styles.empty}>No threads yet. Post breaking news to start one.</p>
      ) : null}
      {result?.kind === "ready" ? (
        <div className={styles.xThreads}>
          {result.threads.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              defaultHandle={senders[0] ?? ""}
              busy={busy}
              onReply={(target, authorHandle, text) => {
                run("reply", { id: crypto.randomUUID(), inReplyToId: target.id, authorHandle, text });
              }}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
