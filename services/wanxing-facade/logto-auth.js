// ── Logto ID token verification (⑤ increment 2: identity) ───────────────────
//
// The console's identity gate: SPA (public client, PKCE) gets an ID token
// from the tenant OIDC; the facade verifies it (ES384 via JWKS) and applies
// an email allowlist — fail-closed, the ops-console tenant's proven pattern
// (Logto 1.42 never issues role/group claims, so the list IS the permission).
// The code exchange is proxied through the facade so the static face never
// fights browser CORS on the token endpoint.

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

const b64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function createLogtoAuth({ endpoint, appId, allowlist, fetchImpl = null, now = () => Date.now() }) {
  const base = endpoint.replace(/\/+$/, "");
  const jwksUri = `${base}/oidc/jwks`;
  const allowed = new Set(
    String(allowlist || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  let jwks = null;
  let jwksAt = 0;

  const configured = Boolean(endpoint && appId && allowed.size > 0);

  async function getJwks() {
    if (jwks && now() - jwksAt < 10 * 60_000) return jwks;
    const r = await (fetchImpl ?? fetch)(jwksUri, { headers: { Accept: "application/json" } });
    if (!r.ok) throw Object.assign(new Error(`jwks fetch ${r.status}`), { status: 502 });
    jwks = await r.json();
    jwksAt = now();
    return jwks;
  }

  // Verify a Logto ID token; returns { email, sub } or null (never throws —
  // an unverifiable token is just not this gate's credential).
  async function verifyIdToken(token) {
    if (!configured || typeof token !== "string") return null;
    try {
      const [h, p, s] = token.split(".");
      if (!h || !p || !s) return null;
      const header = JSON.parse(b64u(h).toString("utf8"));
      const payload = JSON.parse(b64u(p).toString("utf8"));
      if (header.alg !== "ES384") return null;
      const ks = await getJwks();
      const jwk = (ks.keys ?? []).find((k) => k.kid === header.kid && k.kty === "EC");
      if (!jwk) {
        jwks = null; // force a re-fetch next time (rotation)
        return null;
      }
      const key = createPublicKey({ key: jwk, format: "jwk" });
      const okSig = cryptoVerify("sha384", Buffer.from(`${h}.${p}`), key, b64u(s));
      const iss = `${base}/oidc`;
      if (!okSig) return null;
      if (payload.iss !== iss) return null;
      if (payload.aud !== appId) return null;
      if (Number(payload.exp) * 1000 <= now()) return null;
      const email = String(payload.email ?? "").toLowerCase();
      if (!email || !allowed.has(email)) return null;
      return { email, sub: payload.sub };
    } catch {
      return null;
    }
  }

  // PKCE exchange, proxied server-side (CORS-free for the static face).
  async function exchangeCode({ code, verifier, redirectUri }) {
    if (!configured) throw Object.assign(new Error("logto not configured"), { status: 503 });
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code),
      code_verifier: String(verifier),
      client_id: appId,
      redirect_uri: redirectUri,
    });
    const r = await (fetchImpl ?? fetch)(`${base}/oidc/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const doc = await r.json().catch(() => ({}));
    if (!r.ok || !doc.id_token) throw Object.assign(new Error(doc.error_description || `token endpoint ${r.status}`), { status: 502 });
    const ident = await verifyIdToken(doc.id_token);
    if (!ident) throw Object.assign(new Error("identity refused (allowlist or verification)"), { status: 403 });
    return { id_token: doc.id_token, ...ident };
  }

  return {
    configured,
    endpoint: base,
    appId,
    allowlist: allowed,
    verifyIdToken,
    exchangeCode,
    authorizeUrl: ({ redirectUri, state, challenge }) =>
      `${base}/oidc/auth?${new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
  };
}
