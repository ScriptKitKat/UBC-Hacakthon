import { beforeEach, describe, expect, it, vi } from "vitest";
import { openAgentStore } from "@/features/agents";
import { createMemoryFileSystem } from "@/features/storage";
import type { HomeServices } from "@/features/desk";
import type { Desk } from "@/features/desk";
import { PATCH } from "./route";

const getHomeServicesForRequest = vi.hoisted(() => vi.fn<() => Promise<HomeServices>>());

vi.mock("@/features/desk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/desk")>()),
  getHomeServicesForRequest,
}));

const store = openAgentStore({
  fs: createMemoryFileSystem(),
  path: "agents.json",
  now: () => new Date("2026-11-19T18:00:00.000Z"),
  id: () => "agent-1",
});

function patch(body: unknown): Request {
  return new Request("http://localhost:3000/api/agents/agent-1", {
    method: "PATCH",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await store.remove("agent-1");
  const agent = await store.create({ eventTicker: "BTC", instrumentSymbol: "GEMI-BTC-YES", name: "Scout" });
  await store.recordRun(agent.id, { lastTriggerAt: { oddsMove: "2026-11-19T18:00:00.000Z" } });
  getHomeServicesForRequest.mockReset().mockResolvedValue({
    ok: true,
    catalog: { agents: { store, run: vi.fn() } },
    desk: {
      getSnapshot: vi.fn<Desk["getSnapshot"]>(() => Promise.resolve({
        policy: { dailyCapCents: 1000, remainingCents: 1000, perTradeMaxCents: 200, autoApproveMaxCents: 200 },
      } as Awaited<ReturnType<Desk["getSnapshot"]>>)),
    },
  } as unknown as HomeServices);
});

describe("PATCH /api/agents/:id", () => {
  it("clears trigger cooldowns when permission changes", async () => {
    const response = await PATCH(patch({ permission: "autonomous" }), { params: Promise.resolve({ id: "agent-1" }) });
    expect(response.status).toBe(200);
    expect((await store.get("agent-1"))?.lastTriggerAt).toEqual({});
  });

  it("rejects an invalid routine schedule", async () => {
    const response = await PATCH(patch({ schedule: { kind: "daily", time: "9:00", timeZone: "UTC" } }), { params: Promise.resolve({ id: "agent-1" }) });
    expect(response.status).toBe(400);
    expect((await store.get("agent-1"))?.schedule).toEqual({ kind: "none" });
  });
});
