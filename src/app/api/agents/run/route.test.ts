import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCycleOptions, AgentCycleReport, AgentRecord, AgentStore } from "@/features/agents";
import type { HomeServices } from "@/features/desk";
import { POST } from "./route";

const getHomeServicesForRequest = vi.hoisted(() => vi.fn<() => Promise<HomeServices>>());
const getAgent = vi.hoisted(() => vi.fn<AgentStore["get"]>());
const run = vi.hoisted(() => vi.fn<(agentId?: string, options?: AgentCycleOptions) => Promise<AgentCycleReport>>());

vi.mock("@/features/desk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/desk")>()),
  getHomeServicesForRequest,
}));

const report: AgentCycleReport = {
  ran: 1,
  ticks: [{ agentId: "agent-1", fired: [], skipped: [], message: null, messageSource: null, action: "none" }],
};
const watching: AgentRecord = { id: "agent-1", status: "watching" } as AgentRecord;

function post(body: unknown): Request {
  return new Request("http://localhost:3000/api/agents/run", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getAgent.mockReset().mockResolvedValue(watching);
  run.mockReset().mockResolvedValue(report);
  getHomeServicesForRequest.mockReset().mockResolvedValue({
    ok: true,
    catalog: { agents: { store: { get: getAgent }, run } },
  } as unknown as HomeServices);
});

describe("POST /api/agents/run", () => {
  it("runs only the requested agent", async () => {
    const response = await POST(post({ agentId: "agent-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(report);
    expect(getAgent).toHaveBeenCalledWith("agent-1");
    expect(run).toHaveBeenCalledWith("agent-1");
  });

  it("requests a manual review without requiring trigger matches", async () => {
    const response = await POST(post({ agentId: "agent-1", review: true }));
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith("agent-1", { review: true, origin: "manual" });
  });

  it("requires an agent id for a manual review", async () => {
    const response = await POST(post({ review: true }));
    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 404 when the requested agent does not exist", async () => {
    getAgent.mockResolvedValueOnce(undefined);
    const response = await POST(post({ agentId: "missing" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not-found" });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 409 when the requested agent is paused", async () => {
    getAgent.mockResolvedValueOnce({ ...watching, status: "paused" });
    const response = await POST(post({ agentId: "agent-1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "paused" });
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the all-agent path when no id is supplied", async () => {
    const response = await POST(post({}));
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(undefined);
    expect(getAgent).not.toHaveBeenCalled();
  });

  it("rejects extra body fields", async () => {
    const response = await POST(post({ agentId: "agent-1", all: true }));
    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });
});
