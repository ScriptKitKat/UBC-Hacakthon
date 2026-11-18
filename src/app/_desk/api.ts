import type { DecisionLogEntry, DeskSnapshot } from "@/shared";

export type SnapshotResult =
  | { readonly kind: "ready"; readonly snapshot: DeskSnapshot }
  | { readonly kind: "not-configured"; readonly issues: readonly string[] }
  | { readonly kind: "error"; readonly message: string };

export type ActionResult =
  | { readonly ok: true; readonly entry?: DecisionLogEntry }
  | { readonly ok: false; readonly message: string };

interface ErrorBody {
  readonly error?: string;
  readonly issues?: readonly string[];
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function loadSnapshot(): Promise<SnapshotResult> {
  try {
    const response = await fetch("/api/desk", { cache: "no-store" });
    const body = await readJson(response);
    if (response.status === 503) return { kind: "not-configured", issues: (body as ErrorBody | undefined)?.issues ?? [] };
    if (!response.ok) return { kind: "error", message: `Desk responded with HTTP ${String(response.status)}` };
    return { kind: "ready", snapshot: body as DeskSnapshot };
  } catch {
    return { kind: "error", message: "Could not reach the desk server" };
  }
}

export async function postAction(path: string, payload: unknown): Promise<ActionResult> {
  try {
    const response = await fetch(`/api/desk/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await readJson(response)) as (ErrorBody & { entry?: DecisionLogEntry }) | undefined;
    if (!response.ok) return { ok: false, message: body?.issues?.join("; ") ?? body?.error ?? `HTTP ${String(response.status)}` };
    return body?.entry ? { ok: true, entry: body.entry } : { ok: true };
  } catch {
    return { ok: false, message: "Could not reach the desk server" };
  }
}
