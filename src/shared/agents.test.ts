import { describe, expect, it } from "vitest";
import { agentScheduleSchema, nextRoutineAt } from "./agents";

describe("agent schedules", () => {
  it("validates routine time and timezone values", () => {
    expect(agentScheduleSchema.safeParse({ kind: "daily", time: "09:30", timeZone: "America/Chicago" }).success).toBe(true);
    expect(agentScheduleSchema.safeParse({ kind: "daily", time: "25:30", timeZone: "America/Chicago" }).success).toBe(false);
    expect(agentScheduleSchema.safeParse({ kind: "daily", time: "09:30", timeZone: "Not/AZone" }).success).toBe(false);
  });

  it("computes hourly and daily routines", () => {
    expect(nextRoutineAt({ kind: "every", hours: 4 }, "2026-11-19T10:00:00.000Z")?.toISOString()).toBe("2026-11-19T14:00:00.000Z");
    expect(nextRoutineAt({ kind: "daily", time: "09:00", timeZone: "UTC" }, "2026-11-19T08:00:00.000Z")?.toISOString()).toBe("2026-11-19T09:00:00.000Z");
    expect(nextRoutineAt({ kind: "daily", time: "09:00", timeZone: "UTC" }, "2026-11-19T10:00:00.000Z")?.toISOString()).toBe("2026-11-20T09:00:00.000Z");
    expect(nextRoutineAt({ kind: "none" }, "2026-11-19T10:00:00.000Z")).toBeNull();
    expect(nextRoutineAt({ kind: "every", hours: 4 }, null)).toBeNull();
  });

  it("uses the daylight-saving offset for the configured local date", () => {
    expect(nextRoutineAt(
      { kind: "daily", time: "09:00", timeZone: "America/Chicago" },
      "2026-03-07T15:00:00.000Z",
    )?.toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });

  it("does not repeat a daily routine in the fall-back hour", () => {
    expect(nextRoutineAt(
      { kind: "daily", time: "01:30", timeZone: "America/Chicago" },
      "2026-11-01T06:30:00.000Z",
    )?.toISOString()).toBe("2026-11-02T07:30:00.000Z");
  });
});
