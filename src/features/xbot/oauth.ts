import { createHmac } from "node:crypto";
import type { XCredentials } from "./config";

export type OAuthParams = Readonly<Record<string, string>>;

export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function compare(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function signatureBaseString(method: string, url: string, params: OAuthParams): string {
  const requestUrl = new URL(url);
  const normalized = [...requestUrl.searchParams, ...Object.entries(params)]
    .filter(([key]) => key !== "oauth_signature")
    .map(([key, value]) => [percentEncode(key), percentEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => compare(leftKey, rightKey) || compare(leftValue, rightValue))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return [method.toUpperCase(), percentEncode(requestUrl.origin + requestUrl.pathname), percentEncode(normalized)].join("&");
}

export interface SignatureInput {
  readonly method: string;
  readonly url: string;
  readonly params: OAuthParams;
  readonly consumerSecret: string;
  readonly tokenSecret: string;
}

export function oauthSignature(input: SignatureInput): string {
  const key = `${percentEncode(input.consumerSecret)}&${percentEncode(input.tokenSecret)}`;
  return createHmac("sha1", key).update(signatureBaseString(input.method, input.url, input.params)).digest("base64");
}

export interface AuthorizationInput {
  readonly method: string;
  readonly url: string;
  readonly credentials: XCredentials;
  readonly nonce: string;
  readonly timestamp: string;
  readonly requestParams?: OAuthParams;
}

export function authorizationHeader(input: AuthorizationInput): string {
  const { credentials } = input;
  const oauthParams: OAuthParams = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: input.nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: input.timestamp,
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };
  const signature = oauthSignature({
    method: input.method,
    url: input.url,
    params: { ...input.requestParams, ...oauthParams },
    consumerSecret: credentials.apiSecret,
    tokenSecret: credentials.accessSecret,
  });
  const fields = Object.entries({ ...oauthParams, oauth_signature: signature })
    .sort(([left], [right]) => compare(left, right))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`);
  return `OAuth ${fields.join(", ")}`;
}
