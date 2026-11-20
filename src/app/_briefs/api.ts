import { briefLibraryViewSchema } from "@/shared";
import type { BriefLibraryView } from "@/shared";

export type BriefLibraryResult =
  | { readonly kind: "ready"; readonly view: BriefLibraryView }
  | { readonly kind: "not-configured" }
  | { readonly kind: "error"; readonly message: string };

export async function loadBriefLibrary(): Promise<BriefLibraryResult> {
  try {
    const response = await fetch("/api/briefs", { cache: "no-store" });
    if (response.status === 503) return { kind: "not-configured" };
    if (!response.ok) return { kind: "error", message: `The desk responded with HTTP ${String(response.status)}` };
    const parsed = briefLibraryViewSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ready", view: parsed.data } : { kind: "error", message: "The desk sent an unexpected response" };
  } catch {
    return { kind: "error", message: "Could not reach the desk server" };
  }
}
