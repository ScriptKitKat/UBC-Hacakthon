import { expect, it } from "vitest";
import { isStale } from "./runtime-revision";

it("detects revisions written by another runtime only", () => {
  expect(isStale(12, 0, 12)).toBe(false);
  expect(isStale(12, 0, 13)).toBe(true);
  expect(isStale(12, 3, 15)).toBe(false);
  expect(isStale(12, 3, 16)).toBe(true);
});
