import { portfolioViewSchema, positionsViewSchema } from "@/shared";
import type { PortfolioRange, PortfolioView, PositionsView } from "@/shared";

export type PositionsResult =
  | { readonly kind: "ready"; readonly view: PositionsView }
  | { readonly kind: "not-configured" }
  | { readonly kind: "error"; readonly message: string };

export type PortfolioResult =
  | { readonly kind: "ready"; readonly view: PortfolioView }
  | { readonly kind: "not-configured" }
  | { readonly kind: "error"; readonly message: string };

async function readDesk<T>(path: string, parse: (json: unknown) => { success: true; data: T } | { success: false }): Promise<
  { readonly kind: "ready"; readonly view: T } | { readonly kind: "not-configured" } | { readonly kind: "error"; readonly message: string }
> {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (response.status === 503) return { kind: "not-configured" };
    if (!response.ok) return { kind: "error", message: `Positions responded with HTTP ${String(response.status)}` };
    const parsed = parse(await response.json());
    return parsed.success ? { kind: "ready", view: parsed.data } : { kind: "error", message: "Positions sent an unexpected response" };
  } catch {
    return { kind: "error", message: "Could not reach the desk server" };
  }
}

export async function loadPositions(): Promise<PositionsResult> {
  return readDesk("/api/positions", (json) => positionsViewSchema.safeParse(json));
}

export async function loadPortfolio(range: PortfolioRange): Promise<PortfolioResult> {
  return readDesk(`/api/positions/portfolio?range=${range}`, (json) => portfolioViewSchema.safeParse(json));
}

export async function downloadActivityCsv(range: PortfolioRange): Promise<{ readonly kind: "ok" } | { readonly kind: "error"; readonly message: string }> {
  try {
    const response = await fetch(`/api/positions/export?range=${range}`, { cache: "no-store" });
    if (!response.ok) return { kind: "error", message: `Export failed with HTTP ${String(response.status)}` };
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `portfolio-activity-${range}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    return { kind: "ok" };
  } catch {
    return { kind: "error", message: "Could not download the activity CSV" };
  }
}
