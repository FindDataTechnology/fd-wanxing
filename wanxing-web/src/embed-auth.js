// Embed credential ladder (add-embed-copilot-lane D1/D3/D4).
//
// The embed widget runs inside a cross-site iframe whose storage is
// partitioned by the embedding site — so it keeps its OWN credentials here
// (localStorage under embed-scoped keys) and never reads or writes the
// console auth store (auth.js): the console's cross-tab `storage` sync does
// not cross partitions, and a popup login lands in the UNPARTITIONED bucket
// anyway (handed over by postMessage, see auth.js handleConsoleCallback).
//
// Ladder per turn: host-relayed tenant token (never persisted) → stored
// tenant credential (popup login; silently renewed) → anonymous ephemeral
// token (minted per agent, origin-attested). The server is the arbiter of
// what each tier may do; this module only picks the bearer.

const credKey = (slug) => `wx-embed-cred:${slug}`; // { idToken, refreshToken, email }
const anonKey = (slug) => `wx-embed-anon:${slug}`; // { token, expiresAt }

const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? "null");
  } catch {
    return null;
  }
};

export const credGet = (slug) => read(credKey(slug));
export const credSet = (slug, c) => localStorage.setItem(credKey(slug), JSON.stringify({ idToken: c.idToken, refreshToken: c.refreshToken ?? null, email: c.email ?? "" }));
export const credClear = (slug) => localStorage.removeItem(credKey(slug));
export const anonGet = (slug) => read(anonKey(slug));
export const anonSet = (slug, a) => localStorage.setItem(anonKey(slug), JSON.stringify({ token: a.token, expiresAt: a.expiresAt }));
export const anonClear = (slug) => localStorage.removeItem(anonKey(slug));

// JWT exp in ms (0 when unreadable — treated as expired).
export function tokenExp(jwt) {
  try {
    const b64 = String(jwt).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return Number(JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))).exp) * 1000;
  } catch {
    return 0;
  }
}

export class EmbedAuthError extends Error {
  constructor(code, status, body) {
    super(body?.error?.message || code);
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

// Mint an anonymous credential for this agent. The embedding origin is
// attested in the body (a same-origin fetch carries no browser Origin
// header); the facade enforces it against the agent's allowed-origin list.
export async function mintAnon(slug, origin) {
  const r = await fetch(`/api/wanxing/v1/chat/${encodeURIComponent(slug)}/visitor-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origin: origin || "" }),
  });
  const body = await r.json().catch(() => null);
  if (r.status !== 201 || !body?.token) throw new EmbedAuthError(body?.error?.code ?? `HTTP ${r.status}`, r.status, body);
  anonSet(slug, body);
  return body;
}

// Answer or cancel an in-flight ask on the chat lane's side route
// (add-copilot-control-surface). The bearer is the one the ask's own turn
// used; the facade binds the ask id to that visitor, so any other credential
// is a structured not-found. Returns { status, body } — callers converge the
// card on ASK_UNKNOWN / accepted:false rather than surfacing an error.
export async function answerAsk(slug, bearer, { askId, answers = null, cancelled = false }) {
  const r = await fetch(`/api/wanxing/v1/chat/${encodeURIComponent(slug)}/ask-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(cancelled ? { askId, cancelled: true } : { askId, answers: answers ?? [] }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// One refresh grant through the facade proxy against the embed-stored pair.
export async function refreshCred(slug) {  const c = credGet(slug);
  if (!c?.refreshToken) return false;
  const r = await fetch("/api/wanxing/v1/console/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: c.refreshToken }),
  });
  if (!r.ok) return false;
  const d = await r.json().catch(() => null);
  if (!d?.id_token || !d?.refresh_token) return false;
  credSet(slug, { idToken: d.id_token, refreshToken: d.refresh_token, email: c.email });
  return true;
}

// Pick the bearer for a turn. `hostToken` is the host-relayed identity for
// THIS turn (asked for by the widget, never stored). anonAllowed mirrors the
// agent's embed-config; `origin` is the attested embedding origin.
export async function resolveBearer(slug, { hostToken = null, origin = null, anonAllowed = false } = {}) {
  if (hostToken) return { bearer: hostToken, tier: "tenant", source: "host" };
  const c = credGet(slug);
  if (c?.idToken) {
    if (tokenExp(c.idToken) - Date.now() < 60_000 && c.refreshToken) await refreshCred(slug).catch(() => false);
    const cur = credGet(slug);
    if (cur?.idToken && tokenExp(cur.idToken) > Date.now()) return { bearer: cur.idToken, tier: "tenant", source: "stored", email: cur.email };
    credClear(slug); // dead pair — fall through to anonymous or login
  }
  if (anonAllowed) {
    let a = anonGet(slug);
    if (!a?.token || (a.expiresAt ?? 0) - Date.now() < 60_000) a = await mintAnon(slug, origin);
    return { bearer: a.token, tier: "anon", source: "anon" };
  }
  return { bearer: null, tier: null, source: null };
}
