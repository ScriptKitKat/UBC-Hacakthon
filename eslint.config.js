import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { projectRules } from "./eslint/boundaries.js";

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "coverage/**", "extension/dist/**", "next-env.d.ts"] },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["extension/**/*.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "error" },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["scripts/**/*.mjs", "extension/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", fetch: "readonly", URL: "readonly", Buffer: "readonly" } },
  },
  ...projectRules,
);
