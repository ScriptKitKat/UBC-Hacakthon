import { describe, expect, it } from "vitest";
import { MAX_BET_CENTS, parseCommand } from "./parse-command";

describe("parseCommand bets", () => {
  it.each([
    ["yes 2", "yes", 200],
    ["No $5", "no", 500],
    ["yes 2.50", "yes", 250],
    ["yes 2.5", "yes", 250],
    ["@bot yes 2", "yes", 200],
    ["@newstotradedesk @other NO 3", "no", 300],
    ["  yes    $ 7  ", "yes", 700],
    ["YES 0.29", "yes", 29],
    ["yes 2 usdc", "yes", 200],
    ["no 10 dollars!", "no", 1000],
    ["yes2", "yes", 200],
    ["yes 0.01", "yes", 1],
    ["yes\n2", "yes", 200],
    [`yes ${String(MAX_BET_CENTS / 100)}`, "yes", MAX_BET_CENTS],
  ])("parses %j", (text, outcome, notionalCents) => {
    expect(parseCommand(text)).toEqual({ kind: "bet", outcome, notionalCents });
  });

  it.each([
    "yes 0",
    "yes 0.00",
    "yes -1",
    "yes 2.555",
    "yes abc",
    "yes",
    "no",
    "yes 1e5",
    "yes 99999999999999999999999",
    `yes ${String(MAX_BET_CENTS / 100 + 1)}`,
    "yes 2 no 3",
    "maybe 2",
    "2 yes",
    "yes 2 @bot",
  ])("rejects %j as unknown", (text) => {
    expect(parseCommand(text)).toEqual({ kind: "unknown", text: text.trim() });
  });
});

describe("parseCommand other commands", () => {
  it.each(["approve", "Approve it", "do it", "CONFIRM", "@bot approve", "approve!", "  confirm  "])(
    "parses %j as approve",
    (text) => {
      expect(parseCommand(text)).toEqual({ kind: "approve" });
    },
  );

  it.each(["status", "@bot Status", "status."])("parses %j as status", (text) => {
    expect(parseCommand(text)).toEqual({ kind: "status" });
  });

  it.each(["", "   ", "@bot", "hello there", "approve yes 2", "statuses"])("treats %j as unknown", (text) => {
    expect(parseCommand(text)).toEqual({ kind: "unknown", text: text.trim() });
  });
});
