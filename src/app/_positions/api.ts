import { positionsViewSchema } from "@/shared";
import type { PositionsView } from "@/shared";

export type PositionsResult =
  | { readonly kind: "ready"; readonly view: PositionsView }
  | { readonly kind: "not-configured" }
  | { readonly kind: "error"; readonly message: string };

export async function loadPositions(): Promise<PositionsResult> {
  try {
    const response = await fetch("/api/positions", { cache: "no-store" });
    if (response.status === 503) return { kind: "not-configured" };
    if (!response.ok) return { kind: "error", message: `Positions responded with HTTP ${String(response.status)}` };
    const parsed = positionsViewSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ready", view: parsed.data } : { kind: "error", message: "Positions sent an unexpected response" };
  } catch {
    return { kind: "error", message: "Could not reach the desk server" };
  }
}
