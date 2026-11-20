import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { projectRules } from "./boundaries.js";

const linter = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: [
    { languageOptions: { parserOptions: { ecmaVersion: "latest", sourceType: "module" } } },
    ...projectRules,
  ],
});

async function ruleIds(code: string, filePath: string) {
  const [result] = await linter.lintText(code, { filePath });
  return result?.messages.map((message) => message.ruleId) ?? [];
}

describe("project lint rules", () => {
  it("rejects deep imports of another feature", async () => {
    const ids = await ruleIds('import { x } from "@/features/ledger/internal";\n', "src/features/execution/a.ts");
    expect(ids).toContain("no-restricted-imports");
  });

  it("allows another feature's public index", async () => {
    const ids = await ruleIds('import { x } from "@/features/ledger";\nexport { x };\n', "src/features/execution/a.ts");
    expect(ids).toEqual([]);
  });

  it("rejects features importing app", async () => {
    const ids = await ruleIds('import { x } from "@/app/page";\n', "src/features/markets/a.ts");
    expect(ids).toContain("no-restricted-imports");
  });

  it("rejects shared importing features", async () => {
    const ids = await ruleIds('import { x } from "@/features/markets";\n', "src/shared/a.ts");
    expect(ids).toContain("no-restricted-imports");
  });

  it("rejects server features in client components", async () => {
    const ids = await ruleIds('"use client";\nimport { x } from "@/features/ledger";\n', "src/app/c.tsx");
    expect(ids).toContain("local/no-server-imports-in-client");
  });

  it("rejects the desk feature in client components", async () => {
    const ids = await ruleIds('"use client";\nimport { x } from "@/features/desk";\n', "src/app/c.tsx");
    expect(ids).toContain("local/no-server-imports-in-client");
  });

  it.each(["storage", "history", "research", "positions"])("rejects the server feature %s in client components", async (feature) => {
    const ids = await ruleIds(`"use client";\nimport { x } from "@/features/${feature}";\n`, "src/app/c.tsx");
    expect(ids).toContain("local/no-server-imports-in-client");
  });

  it("rejects raw useEffect in app code but allows the polling wrapper", async () => {
    const code = 'import { useEffect } from "react";\nexport { useEffect };\n';
    expect(await ruleIds(code, "src/app/c.tsx")).toContain("no-restricted-imports");
    expect(await ruleIds(code, "src/app/_desk/use-polling.ts")).toEqual([]);
  });

  it("allows server features in server components", async () => {
    const ids = await ruleIds('import { x } from "@/features/ledger";\n', "src/app/s.tsx");
    expect(ids).toEqual([]);
  });

  it("rejects console.log in features", async () => {
    const ids = await ruleIds("console.log(1);\n", "src/features/desk/a.ts");
    expect(ids).toContain("no-restricted-syntax");
  });

  it("rejects line, block and directive comments", async () => {
    const ids = await ruleIds("// a\n/* b */\n/* eslint-disable */\nexport {};\n", "src/shared/a.ts");
    expect(ids.filter((id) => id === "local/no-comments")).toHaveLength(3);
  });

  it.each([
    ['import { x } from "@/features/desk";\n', "extension/src/a.ts"],
    ['import { x } from "@/app/page";\n', "extension/src/a.ts"],
    ['import { x } from "../../src/features/desk";\n', "extension/src/a.ts"],
    ['import { x } from "@/shared/desk";\n', "extension/src/a.ts"],
  ])("rejects extension import %s", async (code, filePath) => {
    expect(await ruleIds(code, filePath)).toContain("no-restricted-imports");
  });

  it("allows the extension to import shared types and its own modules", async () => {
    const ids = await ruleIds('import { x } from "@/shared";\nimport { y } from "./y";\nexport { x, y };\n', "extension/src/a.ts");
    expect(ids).toEqual([]);
  });

});
