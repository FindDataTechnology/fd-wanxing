// ── Wanxing facade wiring — standalone unit (add-facade-extraction) ──────────
//
// ADR-0014's external front door, extracted from the paas gateway (program
// slice ②) into the Wanxing plane's own deployment: the A2A protocol face
// over the protocol-agnostic kernel and the ops usage view (service
// credential only). The registry stays internal — the facade reaches runtime
// routes through the registry proxy with the platform's own credentials.
// Deployment bookkeeping is read over HTTP (the packs surface's internal API,
// env-repointable). The gateway-mounted era's login-scoped caller-allowlist
// management routes did NOT move: they ride the Yizuo login session this unit
// does not have — the deployer product surface (slice ⑤) rebuilds them; the
// allowlist store and core admission checks are unchanged.

import path from "node:path";
import { createWanxingStore } from "./store.js";
import { createWanxingCore, slugFor } from "./core.js";
import { createA2aFace } from "./a2a.js";
import { createBookkeepingCache, diffDeployments } from "./bookkeeping.js";
import { createFleetReporter } from "./fleet-report.js";
import { registerConsoleRoutes } from "./console.js";
import { createLogtoAuth } from "./logto-auth.js";
import { createSub2apiClient } from "./lib/sub2api-admin.js";

export function registerWanxingRoutes(app, {
  dataRoot,
  env = process.env,
  // Injection seams for tests.
  fetchImpl = null,
  store: storeOpt = null,
  sub2api: sub2apiOpt = null,
}) {
  const store = storeOpt ?? createWanxingStore({ file: path.join(dataRoot, "wanxing.db") });

  const registryUrl = () => (env.AGENT_SERVING_REGISTRY_URL || env.REGISTRY_URL || "").replace(/\/+$/, "");
  const registryToken = () => env.AGENT_SERVING_REGISTRY_TOKEN || env.MARKET_REGISTRY_TOKEN || "";
  const backendToken = () => env.AGENT_SERVING_BACKEND_TOKEN || "";

  const sub2api =
    sub2apiOpt ??
    (env.SUB2API_ADMIN_KEY
      ? createSub2apiClient({
          baseUrl: env.SUB2API_BASE_URL || "http://127.0.0.1:32080",
          adminKey: env.SUB2API_ADMIN_KEY,
          ...(fetchImpl ? { fetchImpl } : {}),
        })
      : null);

  const core = createWanxingCore({ store, sub2api });

  const doFetch = (p, init = {}) =>
    (fetchImpl ?? fetch)(`${registryUrl()}${p}`, {
      ...init,
      headers: {
        ...(registryToken() ? { Authorization: `Bearer ${registryToken()}` } : {}),
        ...(init.headers ?? {}),
      },
    });

  // Dual internal credentials for runtime forwarding — the same pair the
  // platform's a2a client rides (registry service credential on
  // X-Authorization, deployment backend credential on Authorization).
  const forwardHeaders = () => ({
    "X-Authorization": `Bearer ${registryToken()}`,
    Authorization: `Bearer ${backendToken()}`,
  });

  // ── Deployment bookkeeping over the packs internal API (S0) ────────────────
  // Read-only, service-credential gated (the same registry token the runner
  // rides). Base URL is env-driven and read per call so S1's extraction (and
  // tests) repoint it without touching this module; the loopback default is
  // the marketplace mounted in this same process.
  const packsInternalBase = () =>
    (env.PACKS_INTERNAL_BASE_URL || `http://127.0.0.1:${env.GATEWAY_PORT || 3080}`).replace(/\/+$/, "");
  const packsInternalFetch = async (p) => {
    let r;
    try {
      r = await (fetchImpl ?? fetch)(`${packsInternalBase()}${p}`, {
        headers: { Authorization: `Bearer ${registryToken()}` },
      });
    } catch {
      throw Object.assign(new Error(`packs internal API unreachable (${p})`), { code: "PACKS_INTERNAL_UNAVAILABLE" });
    }
    if (!r.ok) {
      throw Object.assign(new Error(`packs internal API ${p} -> ${r.status}`), { code: "PACKS_INTERNAL_UNAVAILABLE" });
    }
    return r.json();
  };

  // Slug resolution and the catalog read the bookkeeping snapshot cache
  // (add-wanxing-deployments-cache): TTL refresh + single-flight, slug Map
  // for O(1) turns, stale-on-hiccup with a hard window for enumeration
  // faces. diffDeployments is re-exported for the fleet observer (fd-wanxing
  // slice ③ reuses it by minimal copy until slice ② converges the two).
  const bookkeeping = createBookkeepingCache({
    fetchRows: async () => (await packsInternalFetch("/api/packs/internal/deployments")).deployments ?? [],
    ttlMs: 15_000,
    hardStaleMs: 300_000,
    onRefresh: (diff) => {
      const n = diff.added.length + diff.removed.length + diff.changed.length;
      if (n) console.log(`[wanxing] bookkeeping diff: +${diff.added.length} -${diff.removed.length} ~${diff.changed.length}`);
    },
  });
  const resolveDeployment = (slug) => (slug ? bookkeeping.resolve(slug) : Promise.resolve(null));
  const listDeployments = async () =>
    (await bookkeeping.rows()).map((d) => ({ slug: slugFor(d.agentPath), agentPath: d.agentPath }));

  // Cross-process fleet reporting (add-fleet-event-backbone 6.3): the facade
  // reports admission/settlement toward the Wanxing observer while it still
  // lives here — slice ② replaces this with the in-process store write.
  const fleetReporter = createFleetReporter({
    url: env.FLEET_OBSERVER_URL || "",
    token: env.FLEET_OBSERVER_TOKEN || "",
    source: "facade",
    fetchImpl: fetchImpl ?? undefined,
    log: (m) => console.warn(`[wanxing:fleet] ${m}`),
  });
  fleetReporter.start();

  // Console management surface (⑤ increment 1): token-gated for now — the
  // console credential is the ingest token the web face already holds; the
  // Logto identity increment replaces the gate, not the routes.
  const consoleToken = () => env.FLEET_OBSERVER_TOKEN || env.WANXING_CONSOLE_TOKEN || "";
  const logtoAuth = createLogtoAuth({
    endpoint: env.WANXING_LOGTO_ENDPOINT || "",
    appId: env.WANXING_LOGTO_APP_ID || "",
    allowlist: env.WANXING_CONSOLE_ALLOWLIST || "",
    fetchImpl: fetchImpl ?? undefined,
  });
  registerConsoleRoutes(app, {
    requireToken: (req) => {
      const t = consoleToken();
      return Boolean(t) && req.headers.authorization === `Bearer ${t}`;
    },
    logtoAuth,
    bookkeeping,
    store,
    sub2api,
    registryFetch: doFetch,
    log: (m) => console.log(`[wanxing:console] ${m}`),
  });

  const face = createA2aFace({
    core,
    resolveDeployment,
    listDeployments,
    hardStale: () => bookkeeping.hardStale(),
    ensureFresh: () => bookkeeping.poke(),
    report: (ev) => fleetReporter.report(ev),
    forwardHeaders,
    registryFetch: doFetch,
    config: {
      // Runtime route through the registry proxy (ADR-0004's distribution
      // plane) — the facade never addresses runner origins directly.
      agentUrlFor: (agentPath) => `${registryUrl()}/agent${agentPath}/`,
    },
    ...(fetchImpl ? { upstreamFetch: fetchImpl } : {}),
  });
  face.register(app);

  // ── Ops usage view (spec: the ops board shows both dimensions) ────────────
  // The extracted unit has no login session: the service credential (the
  // registry token, the same one the ops console rides) is the only door.
  app.get("/api/wanxing/v1/ops/usage", (req, res) => {
    const token = registryToken();
    if (!token || req.headers.authorization !== `Bearer ${token}`) {
      return res.status(401).json({ error: "service credential required" });
    }
    res.json(store.usageBoard());
  });

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Pending-settlement sweep: retries everything the turn path could not
  // settle inline (sub2api hiccup, process restart). Row ids are the
  // deduction idempotency keys, so a sweep is always safe to re-run. Rows the
  // sweep settles report to the fleet observer with the same deterministic
  // event id the inline path used — at most one lands either way.
  const sweepOnce = async () => {
    const before = store.usagePending(); // { id, agent_slug, minutes_billed, rate_usd, … }
    await core.settlePending();
    const stillPending = new Set(store.usagePending().map((r) => r.id));
    for (const row of before) {
      if (stillPending.has(row.id)) continue;
      fleetReporter.report({
        kind: "settled",
        agent: row.agent_slug,
        payload: {
          minutes_billed: row.minutes_billed,
          usd: Number((row.minutes_billed * row.rate_usd).toFixed(4)),
          settlement_status: "settled",
          swept: true,
        },
        id: `facade-${row.id}`,
      });
    }
  };
  const sweep = setInterval(() => void sweepOnce().catch(() => {}), 60_000);
  sweep.unref?.();
  void core.settlePending().catch(() => {});

  return {
    core,
    store,
    face,
    bookkeeping,
    diffDeployments,
    close() {
      clearInterval(sweep);
      fleetReporter.stop();
      if (!storeOpt) store.close();
    },
  };
}
