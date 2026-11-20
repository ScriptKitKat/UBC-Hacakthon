"use client";

import { Dashboard } from "../_desk/dashboard";
import styles from "../_home/home.module.css";
import { AgentActivity } from "./agent-activity";

export function ActivityPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Desk activity</h1>
      <p className={styles.pageLead}>Matched posts, agent decisions, voice, X thread, and pending approvals — the original desk, still live.</p>
      <div className={styles.activityWrap}>
        <Dashboard hideChrome />
      </div>
      <AgentActivity />
    </div>
  );
}
