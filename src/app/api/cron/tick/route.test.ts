import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const runCronTick = vi.hoisted(() => vi.fn());

vi.mock("@/features/desk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/desk")>()),
  runCronTick,
}));

const previousSecret = process.env.CRON_SECRET;

function request(authorization?: string): Request {
  return new Request("http://localhost:3000/api/cron/tick", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeEach(() => {
  delete process.env.CRON_SECRET;
  runCronTick.mockReset();
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;
});

describe("GET /api/cron/tick", () => {
  it("returns 503 when the cron secret is unset", async () => {
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(runCronTick).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer secret does not match", async () => {
    process.env.CRON_SECRET = "configured";
    const response = await GET(request("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(runCronTick).not.toHaveBeenCalled();
  });

  it("runs one cron tick and returns its summary", async () => {
    const summary = { reconciled: true, sampled: true, agents: { ran: 0, ticks: [] } };
    process.env.CRON_SECRET = "configured";
    runCronTick.mockResolvedValue(summary);

    const response = await GET(request("Bearer configured"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(summary);
    expect(runCronTick).toHaveBeenCalledOnce();
  });
});
