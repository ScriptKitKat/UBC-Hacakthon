import { describe, expect, it } from "vitest";
import { authorizationHeader, oauthSignature, percentEncode, signatureBaseString } from "./oauth";

const docsParams = {
  include_entities: "true",
  status: "Hello Ladies + Gentlemen, a signed OAuth request!",
  oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
  oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
  oauth_signature_method: "HMAC-SHA1",
  oauth_timestamp: "1318622958",
  oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
  oauth_version: "1.0",
};
const docsUrl = "https://api.twitter.com/1.1/statuses/update.json";

describe("percentEncode", () => {
  it("encodes per RFC 3986", () => {
    expect(percentEncode("Hello Ladies + Gentlemen, a signed OAuth request!")).toBe(
      "Hello%20Ladies%20%2B%20Gentlemen%2C%20a%20signed%20OAuth%20request%21",
    );
    expect(percentEncode("a-b._c~d")).toBe("a-b._c~d");
    expect(percentEncode("(*')")).toBe("%28%2A%27%29");
  });
});

describe("oauth 1.0a signing", () => {
  it("builds the documented signature base string", () => {
    expect(signatureBaseString("POST", docsUrl, docsParams)).toBe(
      "POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521",
    );
  });

  it("signs decoded query parameters including duplicates and excludes the signature itself", () => {
    expect(signatureBaseString("post", "https://EXAMPLE.com:443/path?a=z&a=a+b&empty&oauth_signature=old#fragment", {
      a: "a+b",
    })).toBe("POST&https%3A%2F%2Fexample.com%2Fpath&a%3Da%2520b%26a%3Da%252Bb%26a%3Dz%26empty%3D");
  });

  it("reproduces the documented signature", () => {
    expect(
      oauthSignature({
        method: "POST",
        url: docsUrl,
        params: docsParams,
        consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      }),
    ).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
  });

  it("produces an OAuth header with sorted, encoded fields and a signature", () => {
    const header = authorizationHeader({
      method: "POST",
      url: "https://api.x.com/2/tweets",
      credentials: { apiKey: "k", apiSecret: "s", accessToken: "t", accessSecret: "ts", bearerToken: "b" },
      nonce: "n+1",
      timestamp: "1700000000",
    });
    expect(header).toMatch(/^OAuth oauth_consumer_key="k", oauth_nonce="n%2B1", oauth_signature="[^"]+", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1700000000", oauth_token="t", oauth_version="1.0"$/u);
  });
});
