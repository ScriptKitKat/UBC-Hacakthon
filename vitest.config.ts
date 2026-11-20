import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  define: { __DEFAULT_DESK_TOKEN__: JSON.stringify("") },
  test: {
    env: { TZ: "America/Chicago" },
    projects: [
      { extends: true, test: { name: "node", include: ["src/**/*.test.ts", "eslint/**/*.test.ts"] } },
      { extends: true, test: { name: "extension", include: ["extension/**/*.test.ts"], environment: "happy-dom" } },
    ],
  },
});
