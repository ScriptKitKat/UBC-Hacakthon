"use client";

import { useId, type ReactNode } from "react";
import styles from "./pro.module.css";

export function Tip({ text, children }: { readonly text: string; readonly children: ReactNode }) {
  const id = useId();
  return (
    <span className={styles.tip} tabIndex={0} title={text} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className={styles.tipBubble}>{text}</span>
    </span>
  );
}
