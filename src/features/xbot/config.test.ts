import { describe, expect, it } from "vitest";
import { loadXConfig } from "./config";

const complete = {
  X_API_KEY: "key",
  X_API_SECRET: "secret",
  X_ACCESS_TOKEN: "token",
  X_ACCESS_SECRET: "token-secret",
  X_BEARER_TOKEN: "bearer",
  X_BOT_USER_ID: "12345",
};

describe("loadXConfig", () => {
  it("is live when every variable is present", () => {
    expect(loadXConfig(complete)).toEqual({
      mode: "live",
      userId: "12345",
      credentials: { apiKey: "key", apiSecret: "secret", accessToken: "token", accessSecret: "token-secret", bearerToken: "bearer" },
    });
  });

  it("is fake with every variable name listed when the environment is empty", () => {
    expect(loadXConfig({})).toEqual({ mode: "fake", missing: Object.keys(complete) });
  });

  it("lists only the missing, empty or blank names and never their values", () => {
    const config = loadXConfig({ ...complete, X_API_SECRET: "", X_BEARER_TOKEN: "   ", X_BOT_USER_ID: undefined });
    expect(config).toEqual({ mode: "fake", missing: ["X_API_SECRET", "X_BEARER_TOKEN", "X_BOT_USER_ID"] });
    expect(JSON.stringify(config)).not.toContain("token-secret");
  });
});
