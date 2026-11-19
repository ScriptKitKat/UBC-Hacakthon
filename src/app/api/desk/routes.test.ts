import { describe, expect, it } from "vitest";
import { POST as confirm } from "./confirm/route";
import { POST as killSwitch } from "./kill-switch/route";
import { POST as news } from "./news/route";
import { POST as propose } from "./propose/route";
import { GET as snapshot } from "./route";

const SAME_ORIGIN = { "sec-fetch-site": "same-origin" };

const post = (body: unknown) =>
  new Request("http://desk.test", { method: "POST", headers: SAME_ORIGIN, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("desk api validation", () => {
  it.each([
    ["news", news, { text: "" }],
    ["news url", news, { text: "x", url: "nope" }],
    ["propose outcome", propose, { instrumentSymbol: "A", outcome: "maybe", notionalCents: 1, senderId: "s" }],
    ["propose fractional cents", propose, { instrumentSymbol: "A", outcome: "yes", notionalCents: 1.5, senderId: "s" }],
    ["propose negative", propose, { instrumentSymbol: "A", outcome: "yes", notionalCents: -1, senderId: "s" }],
    ["confirm", confirm, { intentId: "" }],
    ["kill switch", killSwitch, { on: "yes" }],
    ["malformed json", news, "{"],
  ])("returns 400 for bad %s input", async (_name, handler, body) => {
    const response = await handler(post(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid-request" });
  });

  const dashboardPosts = [
    ["propose", propose, { instrumentSymbol: "A", outcome: "yes", notionalCents: 100, senderId: "priscilla" }],
    ["confirm", confirm, { intentId: "i", approverId: "priscilla" }],
    ["kill switch", killSwitch, { on: false }],
  ] as const;

  it.each(dashboardPosts)("refuses %s posts that carry no browser provenance", async (_name, handler, body) => {
    const response = await handler(new Request("http://localhost:3000/api/desk", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(403);
  });

  it.each(dashboardPosts)("refuses %s posts from another origin, scheme or site", async (_name, handler, body) => {
    const attempts: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "https://localhost:3000" },
      { origin: "http://localhost:3001" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const headers of attempts) {
      const response = await handler(new Request("http://localhost:3000/api/desk", {
        method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: JSON.stringify(body),
      }));
      expect(response.status).toBe(403);
    }
  });

  it("accepts a same-origin dashboard post past the origin check", async () => {
    const response = await killSwitch(new Request("http://localhost:3000/api/desk/kill-switch", {
      method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ on: "bad" }),
    }));
    expect(response.status).toBe(400);
  });

  it("returns 503 with the config issues when the desk is not configured", async () => {
    const response = await snapshot();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "desk-misconfigured", issues: expect.arrayContaining([expect.stringContaining("DAILY_CAP_USD")]) as unknown });
  });
});
