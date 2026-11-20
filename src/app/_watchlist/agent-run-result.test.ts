import { describe, expect, it } from "vitest";
import { agentRunResultText } from "./agent-run-result";

describe("agentRunResultText", () => {
  it("reports unavailable market data", () => {
    expect(agentRunResultText({ fired: [], skipped: [], marketUnavailable: true }, [])).toBe("Couldn't load market data for this run.");
  });

  it("reports fired trigger labels", () => {
    expect(agentRunResultText({ fired: ["oddsMove"], skipped: [] }, ["Odds moved"])).toBe("Fired: Odds moved");
  });

  it("reports distinct skip reasons or no watched condition", () => {
    expect(agentRunResultText({ fired: [], skipped: [{ reason: "data unavailable" }, { reason: "data unavailable" }] }, [])).toBe("Nothing fired — data unavailable");
    expect(agentRunResultText({ fired: [], skipped: [] }, [])).toBe("No watched condition is true right now");
  });
});
