/**
 * Shared test helpers: D1 schema setup + RSA key pair + JWT signing.
 */
import { env } from "cloudflare:test";

// ── D1 schema ─────────────────────────────────────────────────────────────────

// Mirror of migrations/0001_initial.sql — kept in sync manually.
// D1's exec() only accepts a single statement; use batch() for multiple DDL.
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    sso_id     TEXT NOT NULL UNIQUE,
    provider   TEXT NOT NULL,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    owner_id   TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(id),
    user_id    TEXT NOT NULL REFERENCES users(id),
    role       TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
    PRIMARY KEY (project_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id),
    name        TEXT NOT NULL,
    r2_key      TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('tex', 'bib', 'image', 'pdf')),
    size        INTEGER,
    updated_at  TEXT NOT NULL,
    updated_by  TEXT NOT NULL REFERENCES users(id),
    UNIQUE (project_id, name)
  )`,
];

export async function applySchema(): Promise<void> {
  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
}

// ── RSA key pair + JWT signing ────────────────────────────────────────────────

export interface TestKeyPair {
  privateKey: CryptoKey;
  /** Public key as JWK with a `kid` field, ready to serve as JWKS. */
  jwk: JsonWebKey & { kid: string };
}

export async function generateTestKeyPair(): Promise<TestKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return { privateKey: keyPair.privateKey, jwk: { ...exported, kid: "test-kid-1" } };
}

function toB64Url(data: ArrayBuffer | string): string {
  const bin =
    typeof data === "string" ? data : String.fromCharCode(...new Uint8Array(data));
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function signJwt(
  payload: Record<string, unknown>,
  pair: TestKeyPair,
): Promise<string> {
  const header = { alg: "RS256", kid: pair.jwk.kid, typ: "JWT" };
  const headerB64 = toB64Url(JSON.stringify(header));
  const payloadB64 = toB64Url(JSON.stringify(payload));
  const input = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${toB64Url(sig)}`;
}

/**
 * Tampers with the signature part of a JWT by flipping bits in the decoded
 * binary bytes. Changing a base64url *character* is unreliable because the
 * last character of a base64 group may carry only padding bits that atob()
 * ignores — leaving the decoded bytes identical to the original.
 * This function operates on the actual bytes, guaranteeing a real change.
 */
export function tamperJwtSignature(jwt: string): string {
  const parts = jwt.split(".");
  const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = new Uint8Array(
    atob(b64).split("").map((c) => c.charCodeAt(0)),
  );
  // Flip the first byte — guaranteed to change the decoded signature.
  bytes[0] ^= 0xff;
  parts[2] = btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return parts.join(".");
}

/** Returns a valid, non-expired set of Access claims for the test audience. */
export function testClaims(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    sub: "sso-test-001",
    email: "alice@example.com",
    name: "Alice Test",
    aud: "test-audience-12345",
    iss: "https://test.cloudflareaccess.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}
