"use client";

import styles from "./star-button.module.css";

export function StarButton({
  pressed,
  onToggle,
  label,
}: {
  readonly pressed: boolean;
  readonly onToggle: () => void;
  readonly label?: string;
}) {
  return (
    <button
      type="button"
      className={styles.star}
      aria-pressed={pressed}
      aria-label={label ?? (pressed ? "Remove from watchlist" : "Save to watchlist")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill={pressed ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.6 6.7 19.5l1.1-6L3.4 9.3l6-.8z" />
      </svg>
    </button>
  );
}
