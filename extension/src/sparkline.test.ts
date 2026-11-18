import { describe, expect, it } from "vitest";
import { buildSparkline } from "./sparkline";

describe("buildSparkline", () => {
  it("needs at least three distinct points", () => {
    expect(buildSparkline([50, 52], 100, 40)).toBeUndefined();
    expect(buildSparkline([], 100, 40)).toBeUndefined();
    expect(buildSparkline([50, 50, 50], 100, 40)).toBeUndefined();
    expect(buildSparkline([50, 52, 50, 52], 100, 40)).toBeUndefined();
  });

  it("draws a rising line from bottom-left to top-right", () => {
    const sparkline = buildSparkline([40, 50, 60], 100, 40);
    expect(sparkline?.trend).toBe("up");
    expect(sparkline?.line).toBe("M2 38 L50 20 L98 2");
    expect(sparkline?.end).toEqual({ x: 98, y: 2 });
    expect(sparkline?.area.endsWith("Z")).toBe(true);
  });

  it("reports falling and flat-ended trends", () => {
    expect(buildSparkline([60, 55, 50], 100, 40)?.trend).toBe("down");
    expect(buildSparkline([50, 60, 55, 50], 100, 40)?.trend).toBe("flat");
  });

  it("does not exaggerate tiny moves", () => {
    const sparkline = buildSparkline([50, 49, 51], 100, 40);
    expect(sparkline?.end.y).toBeGreaterThan(8);
  });
});
