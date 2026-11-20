import { describe, expect, it } from "vitest";
import type { AgentSummaryRecord } from "./agent-summary";
import { agentPermissionLine, agentRoutineLine, agentSpendLine, agentStatusText, lastCheckText, nextCheckSeconds, relativeTime, spentTodayCents } from "./agent-summary";

const NOW = new Date("2026-11-20T12:00:00.000Z");

function summary(overrides: Partial<AgentSummaryRecord> = {}): AgentSummaryRecord {
  return {
    status: "watching",
    lastRunAt: null,
    spentTodayCents: 150,
    spendDay: "2026-11-20",
    dailyBudgetCents: 300,
    permission: "watch",
    maxPerBetCents: 200,
    schedule: { kind: "none" },
    lastRoutineAt: null,
    ...overrides,
  };
}

describe("agent summary", () => {
  it("shows the run cadence and estimated next check", () => {
    expect(agentStatusText(summary(), NOW)).toBe("Running · checks every minute · next check within a minute");
    expect(nextCheckSeconds("2026-11-20T11:59:40.000Z", NOW)).toBe(40);
    expect(agentStatusText(summary({ lastRunAt: "2026-11-20T11:59:40.000Z" }), NOW))
      .toBe("Running · checks every minute · last check 20s ago · next check in ~40s");
    expect(nextCheckSeconds("2026-11-20T11:58:00.000Z", NOW)).toBe(0);
    expect(agentStatusText(summary({ status: "paused" }), NOW)).toBe("Paused · not checking");
  });

  it("formats last checks and relative activity times", () => {
    expect(lastCheckText(summary(), NOW)).toBe("Not checked yet");
    expect(lastCheckText(summary({ lastRunAt: "2026-11-20T11:59:40.000Z" }), NOW)).toBe("Last check 20s ago");
    expect(relativeTime("2026-11-20T11:00:00.000Z", NOW)).toBe("1h ago");
  });

  it("rolls daily spend at UTC midnight", () => {
    const agent = summary({ spendDay: "2026-11-19" });
    expect(spentTodayCents(agent, NOW)).toBe(0);
    expect(agentSpendLine(agent, NOW)).toBe("$0 of $3 spent today");
    expect(agentSpendLine(summary(), NOW)).toBe("$1.50 of $3 spent today");
  });

  it("describes each permission and the effective autonomous cap", () => {
    expect(agentPermissionLine(summary({ permission: "watch" }), { autoApproveMaxCents: 200 }))
      .toEqual({ text: "Only sends messages", portfolioLink: false });
    expect(agentPermissionLine(summary({ permission: "suggest" }), { autoApproveMaxCents: 200 }))
      .toEqual({ text: "Suggests bets up to $2 for you to approve here on the Agents page", portfolioLink: false });
    expect(agentPermissionLine(summary({ permission: "autonomous", maxPerBetCents: 500 }), { autoApproveMaxCents: 200 }))
      .toEqual({ text: "Bets on its own up to $2 per bet (desk auto-approve limit)", portfolioLink: false });
    expect(agentPermissionLine(summary({ permission: "autonomous", maxPerBetCents: 500 }), { autoApproveMaxCents: 500 }))
      .toEqual({ text: "Bets on its own up to $5 per bet", portfolioLink: false });
  });

  it("shows the next routine time or no routine", () => {
    expect(agentRoutineLine(summary(), NOW)).toBe("No routine");
    expect(agentRoutineLine(summary({
      schedule: { kind: "daily", time: "13:00", timeZone: "UTC" },
      lastRoutineAt: "2026-11-20T08:00:00.000Z",
    }), NOW)).toBe("Next routine: Today 1:00 PM");
    expect(agentRoutineLine(summary({
      schedule: { kind: "every", hours: 4 },
      lastRoutineAt: "2026-11-20T08:00:00.000Z",
    }), NOW)).toContain("Next routine: ");
  });
});
