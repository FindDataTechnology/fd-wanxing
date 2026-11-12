import { slugFor } from "../wanxing-facade/identity.js";
// ── Bookkeeper: registry-list diff → synthesized lifecycle events (4.1) ──────
//
// The deployment-truth synthesizer: polls the registry's agent list (ONE call
// carrying path + metadata.paused — borrowed contract, ADR-0015/paas side)
// and emits deployed/undeployed/paused/resumed on diff. First successful poll
// is a baseline (no events — restarts don't re-announce the world). An empty
// response after a non-empty snapshot is treated as a source flap and skipped:
// mass-undeployed must be confirmed by a second poll, never emitted off one
// suspicious read.
//
// The row-diff helper is the minimal copy of paas's diffDeployments
// (gateway/wanxing/bookkeeping.js, add-wanxing-deployments-cache) — keep the
// two in lockstep until the facade extraction (program slice ②) converges
// them into one home.

const canonical = (v) => {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
};

export function diffRows(prev = [], next = [], keyOf = (r) => r) {
  const prevMap = new Map(prev.map((r) => [keyOf(r), r]));
  const nextMap = new Map(next.map((r) => [keyOf(r), r]));
  const added = [], removed = [], changed = [];
  for (const [k, r] of nextMap) {
    const p = prevMap.get(k);
    if (!p) added.push(r);
    else if (canonical(p) !== canonical(r)) changed.push({ before: p, after: r });
  }
  for (const [k, r] of prevMap) if (!nextMap.has(k)) removed.push(r);
  return { added, removed, changed };
}

// Entry identity for upgrade detection — same fields the runner's reconcile
// treats as descriptor identity (metadata view), deliberately shallow.
const identityOf = (e) => JSON.stringify({
  name: e.name,
  version: e.metadata?.packVersion,
  persona: e.metadata?.persona,
  budget: e.metadata?.effective_budget_minutes,
});

// paas slugFor copy (gateway/wanxing/core.js) — the public agent identity.


export function createBookkeeper({ registryUrl, token, fetchImpl = null, now = Date.now, emit, log = null, intervalMs = 30_000 }) {
  let last = null; // Map<path, {entry, paused, identity}>
  let timer = null;
  let polling = false;

  const doFetch = (p) =>
    (fetchImpl ?? fetch)(`${registryUrl.replace(/\/+$/, "")}${p}`, {
      headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });

  // The serving set mirrors the runner's listServedAgents filter: enabled
  // a2a entries with a pack deployment descriptor. Disabled = undeployed.
  async function fetchSet() {
    const r = await doFetch("/api/agents?limit=500");
    if (!r.ok) throw new Error(`registry list -> ${r.status}`);
    const doc = await r.json();
    const rows = Array.isArray(doc) ? doc : (doc?.agents ?? doc?.items ?? []);
    const set = new Map();
    for (const e of rows) {
      if (!e || e.is_enabled === false) continue;
      if (String(e.supported_protocol || "").toLowerCase() !== "a2a") continue;
      if (!e.path || !e.metadata || typeof e.metadata !== "object" || !e.metadata.packId) continue;
      set.set(e.path, { entry: e, paused: e.metadata?.paused === true, identity: identityOf(e) });
    }
    return set;
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const next = await fetchSet();
      if (last === null) {
        last = next; // baseline: the world as it already is, no announcements
        return;
      }
      if (next.size === 0 && last.size > 0) {
        log?.(`bookkeeper: suspicious empty registry list (${last.size} known) — skipping diff this round`);
        return;
      }
      const prevArr = [...last.entries()].map(([path, v]) => ({ path, ...v }));
      const nextArr = [...next.entries()].map(([path, v]) => ({ path, ...v }));
      const d = diffRows(prevArr, nextArr, (r) => r.path);
      const ts = now();
      for (const r of d.added) emit({ kind: "deployed", agent: slugFor(r.path), ts, payload: { identity: r.identity, source_path: r.path } });
      for (const r of d.removed) emit({ kind: "undeployed", agent: slugFor(r.path), ts, payload: { source_path: r.path } });
      for (const c of d.changed) {
        if (c.before.identity !== c.after.identity) emit({ kind: "deployed", agent: slugFor(c.after.path), ts, payload: { upgrade: true, identity: c.after.identity, source_path: c.after.path } });
        if (c.before.paused !== c.after.paused) emit({ kind: c.after.paused ? "paused" : "resumed", agent: slugFor(c.after.path), ts, payload: { source_path: c.after.path } });
      }
      last = next;
    } catch (e) {
      log?.(`bookkeeper poll failed: ${e.message}`); // keep last; next poll retries
    } finally {
      polling = false;
    }
  }

  return {
    start() {
      if (timer) return;
      void poll();
      timer = setInterval(() => void poll(), intervalMs);
      timer.unref?.();
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    poll, // test seam
    knownSet: () => last,
  };
}
