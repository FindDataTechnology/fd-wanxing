// ── Outbound dependency addressing (one declared table) ─────────────────────
//
// unify-wanxing-shared-semantics D2. Every outbound read of a borrowed
// dependency's address or credential resolves through here. The table exists
// because the same upstream was addressed by DIFFERENT variable families in
// different components, and — worse — by different alias sets on two code
// paths inside ONE component: the memory seam accepted
// `CELL_MEMORY_URL || FD_MEMORY_URL` while the console's memory face accepted
// only `FD_MEMORY_URL`, so a deployment configured the other way had a working
// chat lane and a 503 memory page. That is the failure this module removes.
//
// Rules this table obeys:
//   · the canonical name comes first, aliases after — the published precedence
//     never changes (wanxing-borrowed-contracts pins it);
//   · different components MAY name one upstream differently (they do, and both
//     families are recorded here as the same upstream);
//   · nothing is defaulted into existence: absent resolves to absent, leaving
//     the existing explicit degradation (a 503, or a hidden affordance) intact.
//     The one documented default (packs → loopback) is marked as such.

/**
 * @typedef {{ url?: string[], token?: string[], note?: string }} Addr
 * @typedef {Record<string, Addr>} Component
 */

/** The declared families, per component. */
export const COMPONENTS = /** @type {Record<string, Component>} */ ({
  facade: {
    registry: {
      url: ["AGENT_SERVING_REGISTRY_URL", "REGISTRY_URL"],
      token: ["AGENT_SERVING_REGISTRY_TOKEN", "MARKET_REGISTRY_TOKEN"],
      note: "the observer reaches the same registry under FLEET_REGISTRY_*",
    },
    registryBackend: { token: ["AGENT_SERVING_BACKEND_TOKEN"] },
    packs: {
      url: ["PACKS_INTERNAL_BASE_URL"],
      note: "defaults to the same-process marketplace (http://127.0.0.1:${GATEWAY_PORT}) — a mounting convenience, not a product default",
    },
    sub2api: { url: ["SUB2API_BASE_URL"], token: ["SUB2API_ADMIN_KEY"] },
    memory: {
      url: ["CELL_MEMORY_URL", "FD_MEMORY_URL"],
      token: ["CELL_MEMORY_PLATFORM_TOKEN", "FD_MEMORY_PLATFORM_TOKEN"],
      note: "two spellings for one upstream (paas says CELL_*, this deployment says FD_*) — accepting both is the point",
    },
    facet: { url: ["FACET_BASE_URL"], token: ["FACET_INTERNAL_TOKEN"] },
    observer: { url: ["FLEET_OBSERVER_URL"], token: ["FLEET_OBSERVER_TOKEN"] },
    agentRunner: { note: "proxied through the registry — no address of its own" },
  },
  observer: {
    registry: { url: ["FLEET_REGISTRY_URL"], token: ["FLEET_REGISTRY_TOKEN"] },
    sub2api: {
      url: ["FLEET_STATS_SUB2API_BASE_URL", "FLEET_STATS_SUB2API_BASE"],
      token: ["FLEET_STATS_SUB2API_TOKEN"],
      note: "BASE_URL is canonical; the bare BASE alias is historical",
    },
    ingest: { token: ["FLEET_INGEST_TOKEN"] },
    stats: { token: ["FLEET_STATS_COLLECTOR_TOKEN"] },
  },
  collector: {
    observer: { url: ["OBSERVER_URL"], token: ["FSC_TOKEN"], note: "the desktop collector's own names for the observer upstream" },
  },
});

/**
 * Resolve one upstream for one component.
 * @returns {{ value: string|null, token: string|null, missing: string[], configured: boolean }}
 */
export function resolve(component, upstream, env = process.env) {
  const addr = COMPONENTS[component]?.[upstream];
  if (!addr) throw new Error(`no such upstream: ${component}/${upstream}`);
  const pick = (names) => {
    for (const n of names ?? []) {
      const v = env[n];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    return null;
  };
  const url = pick(addr.url);
  const token = pick(addr.token);
  const missing = [];
  if (addr.url && !url) missing.push(...addr.url);
  if (addr.token && !token) missing.push(...addr.token);
  return {
    value: url,
    token,
    missing,
    configured: Boolean(url || token),
  };
}

/** Same as resolve() but the value is normalised (no trailing slashes, no spaces). */
export function resolveBase(component, upstream, env = process.env) {
  const r = resolve(component, upstream, env);
  return { ...r, value: r.value ? r.value.replace(/\/+$/, "") : null };
}

/** Every variable name this table declares — for the coverage check. */
export function allDeclaredNames() {
  const out = new Set();
  for (const comp of Object.values(COMPONENTS)) {
    for (const addr of Object.values(comp)) {
      for (const n of [...(addr.url ?? []), ...(addr.token ?? [])]) out.add(n);
    }
  }
  return [...out].sort();
}
