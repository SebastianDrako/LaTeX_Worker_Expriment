/**
 * Validates a Cloudflare Access JWT using RS256 + JWKS from the team domain.
 *
 * The JWT is injected by Cloudflare Access in the `Cf-Access-Jwt-Assertion` header.
 * Keys are fetched once and cached for the lifetime of the Worker isolate.
 */

export interface AccessClaims {
  sub: string;      // SSO user ID (unique per provider)
  email: string;
  name: string;
  aud: string | string[];
  iss: string;      // e.g. "https://myteam.cloudflareaccess.com"
  exp: number;
  iat: number;
  /** Identity provider short name injected by some Access IdP configs. */
  identity_nonce?: string;
}

// Module-level JWKS cache: kid → CryptoKey (survives across requests in same isolate)
const keyCache = new Map<string, CryptoKey>();

function b64urlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer;
}

function decodePayload(b64url: string): unknown {
  const json = atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}

async function fetchKey(kid: string, teamDomain: string): Promise<CryptoKey | null> {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) return null;

  const jwks = (await res.json()) as { keys: (JsonWebKey & { kid?: string })[] };
  for (const jwk of jwks.keys) {
    if (jwk.kid !== kid) continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keyCache.set(kid, key);
    return key;
  }
  return null;
}

async function getKey(kid: string, teamDomain: string): Promise<CryptoKey | null> {
  return keyCache.get(kid) ?? fetchKey(kid, teamDomain);
}

export async function validateJwt(
  token: string,
  teamDomain: string,
  aud: string,
): Promise<AccessClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { kid?: string; alg?: string };
  try {
    header = decodePayload(headerB64) as typeof header;
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;

  const key = await getKey(header.kid, teamDomain);
  if (!key) return null;

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = b64urlToBuffer(sigB64);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!valid) return null;

  let claims: AccessClaims;
  try {
    claims = decodePayload(payloadB64) as AccessClaims;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) return null;

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) return null;

  return claims;
}
