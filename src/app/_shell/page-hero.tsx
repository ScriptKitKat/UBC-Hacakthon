import type { ReactNode } from "react";
import styles from "./page-hero.module.css";

export function PageHero({
  title,
  lead,
  children,
}: {
  readonly title: string;
  readonly lead?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className={styles.hero}>
      <span className={styles.cloud} aria-hidden="true" />
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {lead !== undefined ? <p className={styles.lead}>{lead}</p> : null}
      </div>
      {children !== undefined ? <div className={styles.end}>{children}</div> : null}
    </header>
  );
}
