import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchMock } from "cloudflare:test";
import { validateJwt } from "../src/auth";
import { generateTestKeyPair, signJwt, testClaims, type TestKeyPair } from "./helpers";

const TEAM_DOMAIN = "test.cloudflareaccess.com";
const AUD = "test-audience-12345";

let pair: TestKeyPair;

beforeAll(async () => {
  pair = await generateTestKeyPair();

  // Intercept JWKS requests — the key is cached after the first fetch,
  // so we register enough intercepts to cover all tests in this file.
  fetchMock.activate();
  fetchMock.disableNetConnect();

  for (let i = 0; i < 10; i++) {
    fetchMock
      .get(`https://${TEAM_DOMAIN}`)
      .intercept({ path: "/cdn-cgi/access/certs" })
      .reply(200, JSON.stringify({ keys: [pair.jwk] }));
  }
});

afterAll(() => fetchMock.deactivate());

describe("validateJwt — invalid inputs", () => {
  it("returns null for an empty string", async () => {
    expect(await validateJwt("", TEAM_DOMAIN, AUD)).toBeNull();
  });

  it("returns null for a token with wrong number of parts", async () => {
    expect(await validateJwt("only.two", TEAM_DOMAIN, AUD)).toBeNull();
  });

  it("returns null when alg is not RS256", async () => {
    // Manually craft a header with alg=HS256
    const header = btoa(JSON.stringify({ alg: "HS256", kid: "x" }))
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const payload = btoa("{}").replace(/=/g, "");
    expect(await validateJwt(`${header}.${payload}.fakesig`, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it("returns null for an expired JWT", async () => {
    const jwt = await signJwt(testClaims({ exp: Math.floor(Date.now() / 1000) - 1 }), pair);
    expect(await validateJwt(jwt, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it("returns null for wrong audience", async () => {
    const jwt = await signJwt(testClaims({ aud: "wrong-audience" }), pair);
    expect(await validateJwt(jwt, TEAM_DOMAIN, AUD)).toBeNull();
  });

  it("returns null when signature is tampered with", async () => {
    const jwt = await signJwt(testClaims(), pair);
    const parts = jwt.split(".");
    // Flip the last character of the signature
    const last = parts[2];
    parts[2] = last.slice(0, -1) + (last.endsWith("A") ? "B" : "A");
    expect(await validateJwt(parts.join("."), TEAM_DOMAIN, AUD)).toBeNull();
  });
});

describe("validateJwt — valid JWT", () => {
  it("returns claims for a correctly signed, non-expired token", async () => {
    const jwt = await signJwt(testClaims(), pair);
    const claims = await validateJwt(jwt, TEAM_DOMAIN, AUD);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("sso-test-001");
    expect(claims?.email).toBe("alice@example.com");
    expect(claims?.name).toBe("Alice Test");
  });

  it("accepts aud as an array containing the expected value", async () => {
    const jwt = await signJwt(testClaims({ aud: [AUD, "other-aud"] }), pair);
    const claims = await validateJwt(jwt, TEAM_DOMAIN, AUD);
    expect(claims).not.toBeNull();
  });
});
