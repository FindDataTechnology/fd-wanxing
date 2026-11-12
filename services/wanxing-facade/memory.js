import { resolveBase } from "./env.js";
// ── Facade chat memory seam (paas add-unified-memory-and-outputs D7) ─────────
//
// "facade/智语走 chat-memory 同一条缝，不分不帕": the room lane (in the paas
// gateway) and this one both read the SAME fd-memory digest face with the SAME
// parameters, so a signed-in visitor's turn is answered with the block their
// own 壹座 chat would have produced. The facade cannot import the paas ladder
// (different repo, different image), so the contract is restated here and
// pinned by tests on both sides:
//
//   GET {CELL_MEMORY_URL}/digest?project=default&q=<the user's text>&k=5&budget=1500
//   Authorization: Bearer <person token for u/<email>>   (minted via /admin/mint)
//
// Rules that must not drift:
//   · anonymous visitors NEVER get memory (no email → no root, no request)
//   · degrade open — any failure returns "" and the turn runs byte-identically
//   · one kill switch with the chat lane: WANXING_FACADE_MEMORY_DIGEST=0
//   · the query is the human's own message, never the transcript

const DEFAULT_K = 5;
const DEFAULT_BUDGET = 1500;
const READ_TIMEOUT_MS = 5000;

// Per-process caches: one person token per email (mint is expensive and the
// token is restart-stable on the paas side too), one resolved config per env.
export function createMemorySeam({ env = process.env, fetchImpl = fetch, log = console } = {}) {
  // One upstream, two spellings (paas says CELL_*, this deployment says FD_*).
  // Resolved through the shared table so this seam and the console's memory face
  // accept EXACTLY the same aliases in the same order — they used to differ, and
  // the difference was a half-working deployment.
  const mem = resolveBase("facade", "memory", env);
  const url = mem.value ?? "";
  const platformToken = mem.token ?? "";
  const off = String(env.WANXING_FACADE_MEMORY_DIGEST ?? "") === "0";
  const enabled = Boolean(url && platformToken) && !off;
  const k = Number(env.CELL_MEMORY_DIGEST_K ?? DEFAULT_K) || DEFAULT_K;
  const budget = Number(env.CELL_MEMORY_DIGEST_BUDGET ?? DEFAULT_BUDGET) || DEFAULT_BUDGET;
  const tokens = new Map(); // email → token | null (null = mint failed, retried next turn)

  async function tokenFor(email) {
    if (tokens.has(email)) return tokens.get(email);
    try {
      const r = await fetchImpl(`${url}/admin/mint`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${platformToken}` },
        body: JSON.stringify({ namespace: `u/${email}`, label: "wanxing-facade" }),
      });
      if (!r.ok) throw new Error(`mint HTTP ${r.status}`);
      const body = await r.json();
      const token = body?.token ?? null;
      tokens.set(email, token);
      return token;
    } catch (e) {
      log.warn?.(`[facade-memory] mint failed for ${email} (degrade open): ${e?.message || e}`);
      return null; // not cached: the next turn retries
    }
  }

  // The block to append, or "" — never throws, never blocks past the timeout.
  async function blockFor({ email, query }) {
    if (!enabled || !email) return "";
    const token = await tokenFor(email);
    if (!token) return "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
      const u = new URL(`${url}/digest`);
      u.searchParams.set("project", "default");
      u.searchParams.set("q", String(query ?? ""));
      u.searchParams.set("k", String(k));
      u.searchParams.set("budget", String(budget));
      const r = await fetchImpl(u, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!r.ok) throw new Error(`digest HTTP ${r.status}`);
      const body = await r.json();
      return typeof body?.digest === "string" ? body.digest : "";
    } catch (e) {
      log.warn?.(`[facade-memory] digest read failed (degrade open): ${e?.message || e}`);
      return "";
    } finally {
      clearTimeout(timer);
    }
  }

  // The turn-shaped helper the chat face calls: returns the prompt to send.
  async function promptWithMemory({ email, text }) {
    const base = String(text ?? "");
    if (!enabled || !email) return base;
    const block = await blockFor({ email, query: base });
    return block ? `${base}\n\n${block}` : base;
  }

  return { enabled, off, blockFor, promptWithMemory, _tokens: tokens };
}
