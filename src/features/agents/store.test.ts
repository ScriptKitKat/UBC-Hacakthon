import { describe, expect, it } from "vitest";
import { createMemoryFileSystem } from "@/features/storage";
import { agentRecordSchema } from "@/shared";
import { openAgentStore } from "./store";

describe("agent store", () => {
  it("creates one agent per market, updates it, and records a run", async () => {
    const store = openAgentStore({
      fs: createMemoryFileSystem(),
      path: "agents.json",
      now: () => new Date("2026-11-19T18:00:00.000Z"),
      id: () => "agent-1",
    });
    const created = await store.create({ eventTicker: "BTC", instrumentSymbol: "GEMI-BTC-YES", name: "Scout" });
    expect(created).toMatchObject({ id: "agent-1", name: "Scout", status: "watching", permission: "suggest", writeBriefs: false, spentTodayCents: 0 });
    expect((await store.create({ eventTicker: "BTC", instrumentSymbol: "GEMI-BTC-YES", name: "Other" })).id).toBe("agent-1");
    const updated = await store.update("agent-1", { name: "Fed watcher", dailyBudgetCents: 400, permission: "watch" });
    expect(updated).toMatchObject({ name: "Fed watcher", dailyBudgetCents: 400, permission: "watch", updatedAt: "2026-11-19T18:00:00.000Z" });
    const ran = await store.recordRun("agent-1", {
      lastMessage: "Yes moved up 6 points.",
      lastMessageSource: "template",
      spentDeltaCents: 5,
      lastTriggerAt: { oddsMove: "2026-11-19T18:00:00.000Z" },
      activity: [{ id: "a1", at: "2026-11-19T18:00:00.000Z", kind: "message", text: "Yes moved up 6 points.", messageSource: "template" }],
    });
    expect(ran).toMatchObject({ lastMessage: "Yes moved up 6 points.", lastMessageSource: "template", spentTodayCents: 5, spendDay: "2026-11-19" });
    expect(ran?.activity[0]?.kind).toBe("message");
  });

  it("pauses, resumes, deletes, and rolls spend on a new UTC day", async () => {
    let now = new Date("2026-11-19T18:00:00.000Z");
    const store = openAgentStore({
      fs: createMemoryFileSystem(),
      path: "agents.json",
      now: () => now,
    });
    const created = await store.create({ eventTicker: "FED", instrumentSymbol: "GEMI-FED-YES" });
    const paused = await store.setStatus(created.id, "paused");
    expect(paused?.status).toBe("paused");
    expect(paused?.activity[0]?.kind).toBe("pause");
    const resumed = await store.setStatus(created.id, "watching");
    expect(resumed?.status).toBe("watching");
    expect(resumed?.activity[0]?.kind).toBe("resume");
    now = new Date("2026-11-20T01:00:00.000Z");
    const rolled = await store.recordRun(created.id, { spentDeltaCents: 25 });
    expect(rolled).toMatchObject({ spentTodayCents: 25, spendDay: "2026-11-20" });
    expect(await store.remove(created.id)).toBe(true);
    expect(await store.get(created.id)).toBeUndefined();
    expect(await store.remove(created.id)).toBe(false);
  });

  it("records the last breaking post while records without it still load", async () => {
    const store = openAgentStore({ fs: createMemoryFileSystem(), path: "agents.json" });
    const created = await store.create({ eventTicker: "BTC", instrumentSymbol: "GEMI-BTC-YES" });
    expect(created.lastBreakingPostId).toBeUndefined();
    expect((await store.get(created.id))?.lastBreakingPostId).toBeUndefined();
    const updated = await store.recordRun(created.id, { lastBreakingPostId: "post-1" });
    expect(updated?.lastBreakingPostId).toBe("post-1");
    expect((await store.get(created.id))?.lastBreakingPostId).toBe("post-1");
  });

  it("defaults older records to no routine and clears cooldowns when permission changes", async () => {
    const store = openAgentStore({
      fs: createMemoryFileSystem(),
      path: "agents.json",
      now: () => new Date("2026-11-19T18:00:00.000Z"),
    });
    const created = await store.create({ eventTicker: "BTC", instrumentSymbol: "GEMI-BTC-YES" });
    const legacy = { ...created } as Record<string, unknown>;
    delete legacy.schedule;
    delete legacy.lastRoutineAt;
    expect(agentRecordSchema.parse(legacy)).toMatchObject({ schedule: { kind: "none" }, lastRoutineAt: null });

    await store.recordRun(created.id, { lastTriggerAt: { oddsMove: "2026-11-19T18:00:00.000Z" } });
    const permission = await store.update(created.id, { permission: "autonomous" });
    expect(permission?.lastTriggerAt).toEqual({});
    const scheduled = await store.update(created.id, { schedule: { kind: "every", hours: 4 } });
    expect(scheduled).toMatchObject({ schedule: { kind: "every", hours: 4 }, lastRoutineAt: "2026-11-19T18:00:00.000Z" });
  });
});
