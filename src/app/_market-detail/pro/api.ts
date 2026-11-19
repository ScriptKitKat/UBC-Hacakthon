import { isProTimeframe, proLiveSchema, proShellSchema } from "@/shared";
import type { ProLive, ProShell, ProTimeframe } from "@/shared";

export type ProShellResult =
  | { readonly kind: "ready"; readonly shell: ProShell }
  | { readonly kind: "unknown" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly message: string };

export type ProLiveResult =
  | { readonly kind: "ready"; readonly live: ProLive }
  | { readonly kind: "unknown" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly message: string };

async function request(symbol: string, part: "shell" | "live", timeframe: ProTimeframe): Promise<Response> {
  return fetch(`/api/research/${encodeURIComponent(symbol)}/pro?part=${part}&timeframe=${timeframe}`, { cache: "no-store" });
}

function classify(response: Response): "unknown" | "unavailable" | "error" {
  if (response.status === 404 || response.status === 400) return "unknown";
  if (response.status === 503) return "unavailable";
  return "error";
}

export async function loadProShell(symbol: string, timeframe: ProTimeframe): Promise<ProShellResult> {
  if (!isProTimeframe(timeframe)) return { kind: "unknown" };
  try {
    const response = await request(symbol, "shell", timeframe);
    if (!response.ok) return classify(response) === "error"
      ? { kind: "error", message: `The desk responded with HTTP ${String(response.status)}` }
      : { kind: classify(response) };
    const parsed = proShellSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ready", shell: parsed.data } : { kind: "error", message: "The desk sent an unexpected response" };
  } catch {
    return { kind: "error", message: "Could not reach the desk server" };
  }
}

export async function loadProLive(symbol: string, timeframe: ProTimeframe): Promise<ProLiveResult> {
  if (!isProTimeframe(timeframe)) return { kind: "unknown" };
  try {
    const response = await request(symbol, "live", timeframe);
    if (!response.ok) return classify(response) === "error"
      ? { kind: "error", message: `The desk responded with HTTP ${String(response.status)}` }
      : { kind: classify(response) };
    const parsed = proLiveSchema.safeParse(await response.json());
    return parsed.success ? { kind: "ready", live: parsed.data } : { kind: "error", message: "The desk sent an unexpected response" };
  } catch {
    return { kind: "error", message: "Could not reach the desk server" };
  }
}
