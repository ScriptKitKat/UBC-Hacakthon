import { describe, expect, it } from "vitest";
import { POST as confirm } from "./confirm/route";
import { POST as killSwitch } from "./kill-switch/route";
import { POST as news } from "./news/route";
import { POST as propose } from "./propose/route";
import { GET as snapshot } from "./route";

const post = (body: unknown) =>
  new Request("http://desk.test", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

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

  it("returns 503 with the config issues when the desk is not configured", async () => {
    const response = await snapshot();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "desk-misconfigured", issues: expect.arrayContaining([expect.stringContaining("DAILY_CAP_USD")]) as unknown });
  });
});
