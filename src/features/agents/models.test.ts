import { describe, expect, it } from "vitest";
import { modelAvailability, preferredModel } from "./models";

describe("modelAvailability", () => {
  it("marks each provider available only when its key is set", () => {
    const models = modelAvailability({ XAI_API_KEY: " ", ANTHROPIC_API_KEY: "k" });
    expect(models.grok.available).toBe(false);
    expect(models.claude.available).toBe(true);
    expect(models.other.available).toBe(false);
  });
});

describe("preferredModel", () => {
  it("defaults new agents to Claude only when Grok is unavailable and Claude is", () => {
    expect(preferredModel(modelAvailability({ ANTHROPIC_API_KEY: "k" }))).toBe("claude");
    expect(preferredModel(modelAvailability({ XAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }))).toBe("grok");
    expect(preferredModel(modelAvailability({}))).toBe("grok");
  });
});
