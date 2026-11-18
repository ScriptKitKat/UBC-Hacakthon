import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) },
  },
  test: { include: ["src/features/ledger/*.integration.ts"], testTimeout: 60_000 },
});
