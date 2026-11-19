import { expect, it } from "vitest";
import { classifySignature } from "./index";

const transactionError = { InstructionError: [0, "Custom"] };

it.each([
  ["confirmed success", { err: null, confirmationStatus: "confirmed" }, 100, 100, "landed"],
  ["finalized error", { err: transactionError, confirmationStatus: "finalized" }, 100, 100, "failed"],
  ["absent and expired", null, 101, 100, "failed"],
  ["absent at the last valid height", null, 100, 100, "pending"],
  ["absent before expiry", null, 99, 100, "pending"],
  ["unfinalized error after expiry", { err: transactionError, confirmationStatus: "confirmed" }, 101, 100, "pending"],
  ["legacy without a status", null, 101, undefined, "pending"],
  ["legacy with confirmed success", { err: null, confirmationStatus: "confirmed" }, undefined, undefined, "landed"],
  ["legacy with finalized error", { err: transactionError, confirmationStatus: "finalized" }, undefined, undefined, "failed"],
  ["absent without a finalized height", null, undefined, 100, "pending"],
  ["missing RPC result", undefined, 101, 100, "pending"],
] as const)("classifies %s", (_label, status, finalizedBlockHeight, lastValidBlockHeight, expected) => {
  expect(classifySignature({ status, finalizedBlockHeight, lastValidBlockHeight })).toBe(expected);
});
