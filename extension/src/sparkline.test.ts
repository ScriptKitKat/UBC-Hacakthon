import { describe, expect, it } from "vitest";
import { buildSparkline } from "./sparkline";

describe("buildSparkline", () => {
  it("needs at least three points", () => {
    expect(buildSparkline([50, 52], 100, 40)).toBeUndefined();
    expect(buildSparkline([], 100, 40)).toBeUndefined();
  });

  it("draws a rising line from bottom-left to top-right", () => {
    const sparkline = buildSparkline([40, 50, 60], 100, 40);
    expect(sparkline?.trend).toBe("up");
    expect(sparkline?.line).toBe("M2 38 L50 20 L98 2");
    expect(sparkline?.end).toEqual({ x: 98, y: 2 });
    expect(sparkline?.area.endsWith("Z")).toBe(true);
  });

  it("reports falling and flat trends and keeps flat series centred", () => {
    expect(buildSparkline([60, 55, 50], 100, 40)?.trend).toBe("down");
    const flat = buildSparkline([50, 50, 50], 100, 40);
    expect(flat?.trend).toBe("flat");
    expect(flat?.line).toBe("M2 20 L50 20 L98 20");
  });

  it("does not exaggerate tiny moves", () => {
    const sparkline = buildSparkline([50, 50, 51], 100, 40);
    expect(sparkline?.end.y).toBeGreaterThan(8);
  });
});
