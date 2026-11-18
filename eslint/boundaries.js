import { noComments } from "./no-comments.js";
import { noServerImportsInClient } from "./no-server-imports-in-client.js";

const localPlugin = {
  rules: {
    "no-comments": noComments,
    "no-server-imports-in-client": noServerImportsInClient,
  },
};

const forbidAppImports = ["@/app", "@/app/**"];

const importBan = (patterns, message) => ({
  "no-restricted-imports": ["error", { patterns: patterns.map((group) => ({ group, message })) }],
});

export const projectRules = [
  { linterOptions: { noInlineConfig: true } },
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    plugins: { local: localPlugin },
    rules: { "local/no-comments": "error" },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      ...importBan(
        [["@/features/*/**"], forbidAppImports, ["../../**"]],
        "Features may import only src/shared and other features' index.ts.",
      ),
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='console'][callee.property.name='log']",
          message: "console.log is forbidden in features.",
        },
      ],
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: importBan(
      [["@/features", "@/features/**"], forbidAppImports, ["../**"]],
      "src/shared must not import features or app.",
    ),
  },
  {
    files: ["extension/**/*.ts"],
    rules: importBan(
      [["@/features", "@/features/**"], forbidAppImports, ["@/shared/**"], ["**/src/**"]],
      "Extension code may import only src/shared (types) and its own folder.",
    ),
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    plugins: { local: localPlugin },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["@/features/*/**"], message: "App may import only features' index.ts." }],
          paths: [
            {
              name: "react",
              importNames: ["useEffect", "useLayoutEffect"],
              message: "Use the usePolling wrapper instead of raw effects.",
            },
          ],
        },
      ],
      "local/no-server-imports-in-client": "error",
    },
  },
  {
    files: ["src/app/**/use-polling.ts"],
    rules: importBan([["@/features/*/**"]], "App may import only features' index.ts."),
  },
];
