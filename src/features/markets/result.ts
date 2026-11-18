export type MarketsError =
  | { readonly kind: "network" }
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "parse" };

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export type MarketsResult<T> = Result<T, MarketsError>;

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function fail<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}
