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

export function createLogtoAuth({ endpoint, appId, allowlist, embedAudiences = "", fetchImpl = null, now = () => Date.now() }) {
  const base = endpoint.replace(/\/+$/, "");
  const jwksUri = `${base}/oidc/jwks`;
  const allowed = new Set(
    String(allowlist || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  // Embed audience allowlist (add-embed-copilot-lane D3): product-line SPA
  // clients of the SAME tenant whose ID tokens the chat lane additionally
  // accepts (host-relayed identity). Never applies to the console gate —
  // only the explicit { acceptEmbedAudiences: true } call shape (chat lane).
  const embedAuds = new Set(
    String(embedAudiences || "")
      .split(",")
      .map((s) => s.trim())
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
  // an unverifiable token is just not this gate's credential). The email
  // allowlist applies by default (the console gate); the chat lane calls
  // with { allowlist: false } — any verified tenant identity may chat, sub
  // is the identity, and an absent email claim degrades to "" (the visitor
  // is still fully identified by sub). acceptEmbedAudiences (embed lane D3)
  // additionally admits ID tokens whose aud is a product-line client on the
  // embed audience allowlist — the host-relayed identity shape. It is never
  // combined with allowlist:true: the console gate stays single-audience.
  async function verifyIdToken(token, { allowlist = true, acceptEmbedAudiences = false } = {}) {
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
      // JWS ECDSA signatures are raw R||S (96 bytes for P-384); node's verify
      // wants DER. Convert before checking (live finding: node-signed test
      // fixtures are DER and pass, real OP tokens never did).
      const raw = b64u(s);
      const der = (() => {
        if (raw[0] === 0x30) return raw; // already DER
        const n = raw.length / 2;
        const trim = (b) => {
          let i = 0;
          while (i < b.length - 1 && b[i] === 0) i += 1;
          const s2 = b.slice(i);
          return s2[0] & 0x80 ? Buffer.concat([Buffer.from([0]), s2]) : s2;
        };
        const r = trim(raw.slice(0, n));
        const s2 = trim(raw.slice(n));
        const body = Buffer.concat([Buffer.from([0x02, r.length]), r, Buffer.from([0x02, s2.length]), s2]);
        return Buffer.concat([Buffer.from([0x30, body.length]), body]);
      })();
      const okSig = cryptoVerify("sha384", Buffer.from(`${h}.${p}`), key, der);
      const iss = `${base}/oidc`;
      if (!okSig) return null;
      if (payload.iss !== iss) return null;
      if (payload.aud !== appId && !(acceptEmbedAudiences && embedAuds.has(payload.aud))) return null;
      if (Number(payload.exp) * 1000 <= now()) return null;
      const email = String(payload.email ?? "").toLowerCase();
      const sub = String(payload.sub ?? "");
      if (!sub) return null; // subject-less tokens identify nobody on either lane
      if (allowlist && (!email || !allowed.has(email))) {
        // Refusals carry what was seen — the operator must be able to tell a
        // mis-allowlist from a claim-less token (live finding: admin-tenant
        // sessions issue username-only tokens).
        throw Object.assign(new Error(`identity refused: email=${email || "(none)"} sub=${sub} allowlist=${[...allowed].join("|")}`), { status: 403, diag: { email: email || null, sub } });
      }
      return { email, sub };
    } catch (e) {
      if (e?.diag) throw e; // diagnostics escape; incidental failures stay silent-null
      return null;
    }
  }

  // Refresh-token grant, same server-side proxy discipline as the exchange:
  // the SPA never talks to the tenant directly. Returns the raw token-endpoint
  // document — rotation means the caller must persist whichever refresh_token
  // comes back (absent = tenant did not rotate; keep the current one).
  async function refreshGrant({ refreshToken }) {
    if (!configured) throw Object.assign(new Error("logto not configured"), { status: 503 });
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(refreshToken ?? ""),
      client_id: appId,
    });
    const r = await (fetchImpl ?? fetch)(`${base}/oidc/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const doc = await r.json().catch(() => ({}));
    if (!r.ok || !doc.id_token) throw Object.assign(new Error(doc.error_description || `token endpoint ${r.status}`), { status: 502 });
    return doc;
  }

  // RFC 7009 revocation, same proxy. The route treats this as best-effort
  // cleanup (never a gate); throwing here only feeds diagnostics.
  async function revokeToken(token) {
    if (!configured) throw Object.assign(new Error("logto not configured"), { status: 503 });
    const body = new URLSearchParams({ token: String(token ?? ""), client_id: appId });
    const r = await (fetchImpl ?? fetch)(`${base}/oidc/token/revocation`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) throw Object.assign(new Error(`revocation endpoint ${r.status}`), { status: 502 });
    return true;
  }

  // PKCE exchange, proxied server-side (CORS-free for the static face).
  // allowlist: false (the chat lane's gate) verifies the token without the
  // console allowlist — any tenant identity exchanges; the console surfaces
  // re-verify with the allowlist per call, so this never widens them.
  async function exchangeCode({ code, verifier, redirectUri, allowlist = true }) {
    if (!configured) throw Object.assign(new Error("logto not configured"), { status: 503 });
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(code ?? ""),
      code_verifier: String(verifier ?? ""),
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
    const ident = await verifyIdToken(doc.id_token, { allowlist });
    if (!ident) throw Object.assign(new Error("identity refused (allowlist or verification)"), { status: 403 });
    // Pass the refresh token through (absent = tenant did not grant
    // offline_access) — the silent-renewal loop is born here.
    return { id_token: doc.id_token, refresh_token: doc.refresh_token ?? null, ...ident };
  }

  return {
    configured,
    endpoint: base,
    appId,
    allowlist: allowed,
    verifyIdToken,
    exchangeCode,
    refreshGrant,
    revokeToken,
    authorizeUrl: ({ redirectUri, state, challenge }) =>
      `${base}/oidc/auth?${new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        response_type: "code",
        // offline_access + prompt=consent is what makes the tenant issue the
        // rotating refresh token the silent renewal rides (the SPA's own
        // login builder must keep exact lockstep).
        scope: "openid email profile offline_access",
        prompt: "consent",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      })}`,
  };
}
