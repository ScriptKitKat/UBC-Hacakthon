import { deepDiveResultSchema, researchViewSchema } from "@/shared";
import type { DeepDiveResult, ResearchTimeframe, ResearchView } from "@/shared";

export type ResearchResult =
  | { readonly kind: "ready"; readonly view: ResearchView }
  | { readonly kind: "unknown" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly message: string };

export async function loadResearch(symbol: string, timeframe: ResearchTimeframe): Promise<ResearchResult> {
  try {
    const response = await fetch(`/api/research/${encodeURIComponent(symbol)}?timeframe=${timeframe}`, { cache: "no-store" });
    if (response.status === 404 || response.status === 400) return { kind: "unknown" };
    if (response.status === 503) return { kind: "unavailable" };
    if (!response.ok) return { kind: "error", message: `Research responded with HTTP ${String(response.status)}` };
    const parsed = researchViewSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ready", view: parsed.data } : { kind: "error", message: "Research sent an unexpected response" };
  } catch {
    return { kind: "error", message: "Could not reach the desk server" };
  }
}

export type PurchaseResult =
  | { readonly kind: "done"; readonly result: DeepDiveResult }
  | { readonly kind: "error"; readonly message: string };

export async function purchaseDeepDive(symbol: string): Promise<PurchaseResult> {
  try {
    const response = await fetch(`/api/research/${encodeURIComponent(symbol)}/deep/purchase`, { method: "POST", cache: "no-store" });
    if (response.status === 503) return { kind: "error", message: "The desk isn't configured to buy research." };
    if (!response.ok) return { kind: "error", message: `The desk responded with HTTP ${String(response.status)}` };
    const parsed = deepDiveResultSchema.safeParse(await response.json());
    return parsed.success ? { kind: "done", result: parsed.data } : { kind: "error", message: "The desk sent an unexpected response" };
  } catch {
    return { kind: "error", message: "Could not reach the desk server" };
  }
}
