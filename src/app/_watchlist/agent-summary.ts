import { formatBudgetCents, rolledSpend } from "@/shared";
import type { AgentRecordView, AgentsView } from "@/shared";

export type AgentSummaryRecord = Pick<
  AgentRecordView,
  "status" | "lastRunAt" | "spentTodayCents" | "spendDay" | "dailyBudgetCents" | "permission" | "maxPerBetCents"
>;

const CHECK_INTERVAL_MS = 60_000;

export function relativeTime(at: string, now: Date): string {
  const elapsedMs = now.getTime() - Date.parse(at);
  if (!Number.isFinite(elapsedMs)) return "Unknown time";
  if (elapsedMs < 5_000) return "just now";
  if (elapsedMs < 60_000) return `${String(Math.floor(elapsedMs / 1_000))}s ago`;
  if (elapsedMs < 60 * 60_000) return `${String(Math.floor(elapsedMs / 60_000))}m ago`;
  if (elapsedMs < 24 * 60 * 60_000) return `${String(Math.floor(elapsedMs / (60 * 60_000)))}h ago`;
  if (elapsedMs < 7 * 24 * 60 * 60_000) return `${String(Math.floor(elapsedMs / (24 * 60 * 60_000)))}d ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function nextCheckSeconds(lastRunAt: string | null, now: Date): number {
  if (lastRunAt === null) return CHECK_INTERVAL_MS / 1_000;
  const lastRunMs = Date.parse(lastRunAt);
  if (!Number.isFinite(lastRunMs)) return CHECK_INTERVAL_MS / 1_000;
  return Math.max(0, Math.ceil((lastRunMs + CHECK_INTERVAL_MS - now.getTime()) / 1_000));
}

export function lastCheckText(agent: Pick<AgentSummaryRecord, "lastRunAt">, now: Date): string {
  return agent.lastRunAt === null ? "Not checked yet" : `Last check ${relativeTime(agent.lastRunAt, now)}`;
}

export function agentStatusText(agent: Pick<AgentSummaryRecord, "status" | "lastRunAt">, now: Date): string {
  if (agent.status === "paused") return "Paused · not checking";
  if (agent.lastRunAt === null) return "Running · checks every minute · next check within a minute";
  return `Running · checks every minute · last check ${relativeTime(agent.lastRunAt, now)} · next check in ~${String(nextCheckSeconds(agent.lastRunAt, now))}s`;
}

export function spentTodayCents(agent: Pick<AgentSummaryRecord, "spentTodayCents" | "spendDay">, now: Date): number {
  return rolledSpend(agent, now).spentTodayCents;
}

export function agentSpendLine(
  agent: Pick<AgentSummaryRecord, "spentTodayCents" | "spendDay" | "dailyBudgetCents">,
  now: Date,
): string {
  return `${formatBudgetCents(spentTodayCents(agent, now))} of ${formatBudgetCents(agent.dailyBudgetCents)} spent today`;
}

export interface AgentPermissionLine {
  readonly text: string;
  readonly portfolioLink: boolean;
}

export function agentPermissionLine(
  agent: Pick<AgentSummaryRecord, "permission" | "maxPerBetCents">,
  desk: Pick<AgentsView["desk"], "autoApproveMaxCents">,
): AgentPermissionLine {
  if (agent.permission === "watch") return { text: "Only sends messages", portfolioLink: false };
  if (agent.permission === "suggest") {
    return {
      text: `Suggests bets up to ${formatBudgetCents(agent.maxPerBetCents)} for you to approve in`,
      portfolioLink: true,
    };
  }
  const effectiveCapCents = Math.min(agent.maxPerBetCents, desk.autoApproveMaxCents);
  const deskLimitNote = effectiveCapCents < agent.maxPerBetCents ? " (desk auto-approve limit)" : "";
  return {
    text: `Bets on its own up to ${formatBudgetCents(effectiveCapCents)} per bet${deskLimitNote}`,
    portfolioLink: false,
  };
}
