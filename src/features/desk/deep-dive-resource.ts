import type { Research } from "@/features/research";
import { PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER, encodeHeader } from "@/features/x402";
import type { X402Server } from "@/features/x402";
import type { ResearchBrief } from "@/shared";

const PAYMENT_REQUIRED = 402;
const FIRST_REQUEST_MESSAGE = "payment_required";

export interface DeepDiveResource {
  readonly urlFor: (symbol: string) => string;
  readonly handle: (request: Request, symbol: string) => Promise<Response>;
  readonly recover: (symbol: string, signature: string) => Promise<ResearchBrief | undefined>;
}

export interface DeepDiveResourceDeps {
  readonly payments: Pick<X402Server, "requirements" | "verify" | "settle" | "recover">;
  readonly research: Research;
  readonly publicOrigin: string;
}

export function deepDiveUrl(publicOrigin: string, symbol: string): string {
  return new URL(`/api/research/${encodeURIComponent(symbol)}/deep`, publicOrigin).href;
}

export function createDeepDiveResource(deps: DeepDiveResourceDeps): DeepDiveResource {
  const { payments, research, publicOrigin } = deps;

  const paymentRequired = (symbol: string, error: string): Response =>
    Response.json(payments.requirements(symbol, `Deep dive research brief for ${symbol}`, error), { status: PAYMENT_REQUIRED });

  return {
    urlFor: (symbol) => deepDiveUrl(publicOrigin, symbol),

    async handle(request, symbol) {
      const header = request.headers.get(PAYMENT_HEADER);
      if (header === null) return paymentRequired(symbol, FIRST_REQUEST_MESSAGE);

      const verified = await payments.verify(header, symbol);
      if (!verified.ok) return paymentRequired(symbol, verified.error);

      const brief = await research.brief(symbol);
      if (brief.kind === "unknown-symbol") return Response.json({ error: "unknown-symbol" }, { status: 404 });
      if (brief.kind === "unavailable") return Response.json({ error: "gemini-unavailable" }, { status: 503 });

      const settled = await payments.settle(verified.value);
      if (!settled.ok) return paymentRequired(symbol, settled.error);
      const { signature, network, payer } = settled.value;
      return Response.json(await brief.polished(), {
        headers: { [PAYMENT_RESPONSE_HEADER]: encodeHeader({ success: true, transaction: signature, network, payer }) },
      });
    },

    async recover(symbol, signature) {
      const settled = await payments.recover(symbol, signature);
      if (!settled.ok) return undefined;
      const brief = await research.brief(symbol);
      return brief.kind === "ok" ? brief.polished() : undefined;
    },
  };
}

export interface DeferredDeepDive {
  readonly resource: DeepDiveResource;
  readonly bind: (target: DeepDiveResource | undefined) => void;
}

export function createDeferredDeepDive(publicOrigin: string): DeferredDeepDive {
  const target: { current: DeepDiveResource | undefined } = { current: undefined };
  return {
    bind(next) {
      target.current = next;
    },
    resource: {
      urlFor: (symbol) => deepDiveUrl(publicOrigin, symbol),
      handle: (request, symbol) =>
        target.current ? target.current.handle(request, symbol) : Promise.resolve(Response.json({ error: "research-payments-not-configured" }, { status: 503 })),
      recover: (symbol, signature) => (target.current ? target.current.recover(symbol, signature) : Promise.resolve(undefined)),
    },
  };
}
