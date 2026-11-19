import { afterEach, expect, it, vi } from "vitest";

import type { MessageSender } from "./sender-guard";

const id = "abcdefghijklmnopabcdefghijklmnop";

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("only fetches positions for its own extension pages and authenticates the read", async () => {
  type Listener = (message: unknown, sender: MessageSender, respond: (reply: unknown) => void) => boolean;
  let listener: Listener | undefined;
  vi.stubGlobal("chrome", {
    runtime: {
      id,
      onMessage: { addListener: (handler: Listener) => { listener = handler; } },
      sendMessage: (request: unknown) => new Promise<unknown>((resolve, reject) => {
        if (!listener?.(request, { id, url: `chrome-extension://${id}/popup.html` }, resolve)) reject(new Error("Popup request refused"));
      }),
    },
    storage: {
      sync: { get: vi.fn().mockResolvedValue({ deskUrl: "https://desk.test/path" }) },
      local: { get: vi.fn().mockResolvedValue({ deskToken: "test-token" }) },
    },
  });
  const value = {
    positions: [],
    totals: { costCents: 0, pricedCostCents: 0, valueCents: 0, pnlCents: 0, pnlPercent: null, unpricedPositions: 0 },
    budget: { dailyCapCents: 2000, spentCents: 0, remainingCents: 2000, researchSpentCents: 0, perTradeMaxCents: 1000, autoApproveMaxCents: 200 },
  };
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value));
  vi.stubGlobal("fetch", send);
  await import("./background");

  const request = { type: "positions" };
  const respond = vi.fn();
  expect(listener?.(request, { id, url: "https://x.com/home", tab: { url: "https://x.com/home" } }, respond)).toBe(false);
  expect(listener?.(request, { id: "foreign", url: `chrome-extension://${id}/popup.html` }, respond)).toBe(false);
  expect(send).not.toHaveBeenCalled();

  const root = document.createElement("main");
  root.id = "positions";
  document.body.append(root);
  await import("./popup");
  await vi.waitFor(() => {
    expect(root.textContent).toContain("Today: $20.00 left of $20.00");
    expect(root.textContent).toContain("No open positions");
  });
  expect(send).toHaveBeenCalledExactlyOnceWith("https://desk.test/api/feed/positions", {
    method: "GET", cache: "no-store", redirect: "error", headers: { authorization: "Bearer test-token" },
  });
});

it("returns only stake limits to X content scripts without granting portfolio access", async () => {
  type Listener = (message: unknown, sender: MessageSender, respond: (reply: unknown) => void) => boolean;
  let listener: Listener | undefined;
  vi.stubGlobal("chrome", {
    runtime: { id, onMessage: { addListener: (handler: Listener) => { listener = handler; } } },
    storage: {
      sync: { get: vi.fn().mockResolvedValue({ deskUrl: "https://desk.test/path" }) },
      local: { get: vi.fn().mockResolvedValue({ deskToken: "test-token" }) },
    },
  });
  const budget = { perTradeMaxCents: 1000, remainingCents: 1800, autoApproveMaxCents: 200 };
  const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    positions: [],
    totals: { costCents: 1200, pricedCostCents: 1200, valueCents: 1500, pnlCents: 300, pnlPercent: 25, unpricedPositions: 0 },
    budget: { dailyCapCents: 2000, spentCents: 200, researchSpentCents: 100, ...budget },
  }));
  vi.stubGlobal("fetch", send);
  await import("./background");
  const sender = { id, url: "https://x.com/home", tab: { url: "https://x.com/home" } };
  const respond = vi.fn();

  expect(listener?.({ type: "budget" }, sender, respond)).toBe(true);
  await vi.waitFor(() => { expect(respond).toHaveBeenCalledExactlyOnceWith({ ok: true, value: budget }); });
  expect(send).toHaveBeenCalledExactlyOnceWith("https://desk.test/api/feed/positions", {
    method: "GET", cache: "no-store", redirect: "error", headers: { authorization: "Bearer test-token" },
  });

  const refused = vi.fn();
  expect(listener?.({ type: "positions" }, sender, refused)).toBe(false);
  expect(listener?.({ type: "budget" }, { ...sender, id: "foreign" }, refused)).toBe(false);
  expect(listener?.({ type: "budget" }, { ...sender, tab: { url: "https://evil.test" } }, refused)).toBe(false);
  expect(refused).toHaveBeenCalledTimes(3);
  expect(refused).toHaveBeenLastCalledWith({ ok: false, error: "Unsupported request." });
  expect(send).toHaveBeenCalledTimes(1);
});
