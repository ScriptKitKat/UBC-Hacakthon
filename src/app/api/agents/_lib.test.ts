import { describe, expect, it } from "vitest";
import { agentWriteBody } from "./_lib";

describe("agent write schedule validation", () => {
  it("rejects invalid routine time and time zone values", () => {
    expect(agentWriteBody.safeParse({ schedule: { kind: "daily", time: "9:00", timeZone: "UTC" } }).success).toBe(false);
    expect(agentWriteBody.safeParse({ schedule: { kind: "daily", time: "09:00", timeZone: "Not/AZone" } }).success).toBe(false);
  });
});
