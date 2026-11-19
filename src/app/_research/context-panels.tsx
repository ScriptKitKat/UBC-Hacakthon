import Link from "next/link";
import type { ResearchPostContext, ResearchRelatedContract, ResearchView } from "@/shared";
import { formatPriceCents } from "./format";
import styles from "./research.module.css";

function isSafeHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function RelatedList({ items, showEvent }: { readonly items: readonly ResearchRelatedContract[]; readonly showEvent: boolean }) {
  return (
    <ul className={styles.relatedList}>
      {items.map((item) => (
        <li key={item.symbol}>
          <Link className={styles.relatedLink} href={`/markets/${item.symbol}`}>
            <span className={styles.relatedName}>
              {showEvent ? <span className={styles.relatedEvent}>{item.eventTitle}</span> : null}
              {item.contractLabel}
            </span>
            <span className={styles.relatedPrices}>
              <span className={styles.pillYes}>YES {formatPriceCents(item.yesCents)}</span>
              <span className={styles.pillNo}>NO {formatPriceCents(item.noCents)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RelatedPanel({ related }: { readonly related: ResearchView["related"] }) {
  return (
    <section className={styles.panel} aria-labelledby="related-heading">
      <h2 id="related-heading" className={styles.panelTitle}>Related markets</h2>
      {related.sameEvent.length > 0 ? (
        <>
          <h3 className={styles.subTitle}>Same event</h3>
          <RelatedList items={related.sameEvent} showEvent={false} />
        </>
      ) : null}
      {related.sameCategory.length > 0 ? (
        <>
          <h3 className={styles.subTitle}>Same category</h3>
          <RelatedList items={related.sameCategory} showEvent />
        </>
      ) : null}
      {related.sameEvent.length === 0 && related.sameCategory.length === 0 ? <p className={styles.empty}>No related markets found.</p> : null}
    </section>
  );
}

export function PostPanel({ post }: { readonly post: ResearchPostContext | null }) {
  if (post === null) return null;
  return (
    <section className={styles.panel} aria-labelledby="post-heading">
      <h2 id="post-heading" className={styles.panelTitle}>{post.source === "x-feed" ? "The post that matched" : "The news that matched"}</h2>
      <blockquote className={styles.postText}>{post.text}</blockquote>
      <p className={styles.postMeta}>
        {post.author === null ? null : <span>{post.author}</span>}
        {post.url !== null && isSafeHttps(post.url) ? (
          <a className={styles.link} href={post.url} target="_blank" rel="noopener noreferrer">
            Open the post ↗
          </a>
        ) : null}
      </p>
      {post.why === null ? null : <p className={styles.explainerNote}>Why it matched: {post.why}</p>}
    </section>
  );
}
