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
import { createChatFace } from "./chat.js";
import { createBookkeepingCache, diffDeployments } from "./bookkeeping.js";
import { createFleetReporter } from "./fleet-report.js";
import { registerConsoleRoutes } from "./console.js";
import { createMissionsFace } from "./missions.js";
import { createSelfServiceFace } from "./selfservice.js";
import { registerPrefsRoutes } from "./prefs.js";
import { createCallbackDispatcher } from "./callbacks.js";
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

  // The share hook resolves a turn's deployer through the bookkeeping
  // snapshot, which is defined below — the late-bound ref breaks the ordering
  // cycle the same way chatFaceRef does for the chat/a2a pair.
  let resolveDeploymentRef = null;
  const core = createWanxingCore({ store, sub2api, resolveDeployment: (slug) => resolveDeploymentRef?.(slug) });

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
  const packsInternalCall = (p, init = {}) =>
    (fetchImpl ?? fetch)(`${packsInternalBase()}${p}`, {
      ...init,
      headers: { Authorization: `Bearer ${registryToken()}`, ...(init.headers ?? {}) },
    });
  const packsInternalFetch = async (p) => {
    let r;
    try {
      r = await packsInternalCall(p);
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
  resolveDeploymentRef = resolveDeployment;
  const listDeployments = async () =>
    (await bookkeeping.rows()).map((d) => ({ slug: slugFor(d.agentPath), agentPath: d.agentPath, packId: d.packId }));

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
    // Service-config proxy (agent-service-config): raw pass-through so the
    // packs surface's status codes (403/400 MODEL_LANE_REJECTED/503) reach
    // the browser verbatim.
    packsInternalFetch: packsInternalCall,
    // Fleet-read forwarding (add-console-session-continuity): the browser face
    // brings an identity, the facade swaps in the observer service credential.
    observerFetch: (() => {
      const observerUrl = () => (env.FLEET_OBSERVER_URL || "").replace(/\/+$/, "");
      const observerToken = () => env.FLEET_OBSERVER_TOKEN || "";
      return async (p) => {
        const base = observerUrl();
        const tok = observerToken();
        if (!base || !tok) throw Object.assign(new Error("observer url/token not configured"), { status: 503 });
        return (fetchImpl ?? fetch)(`${base}${p}`, {
          headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        });
      };
    })(),
    log: (m) => console.log(`[wanxing:console] ${m}`),
  });

  // Caller-preferences face (add-caller-preferences): caller-key authenticated
  // (the same billing gate the A2A door runs), and the completion-callback
  // dispatcher with its bounded retry ladder.
  const callbacks = createCallbackDispatcher({
    store,
    ...(fetchImpl ? { fetchImpl } : {}),
    log: (m) => console.log(`[wanxing:callbacks] ${m}`),
    auditFile: path.join(dataRoot, "callback-audit.jsonl"),
  });
  registerPrefsRoutes(app, { core, store, log: (m) => console.log(`[wanxing:prefs] ${m}`) });

  // Chat lane (add-agent-chat-lane): the a2a face owns agentState (registry
  // entry cache) and the chat face needs it, while the a2a face's catalog
  // marker needs the chat face's chatability — the late-bound ref breaks the
  // cycle without changing either face's shape.
  let chatFaceRef = null;
  const face = createA2aFace({
    core,
    resolveDeployment,
    listDeployments,
    hardStale: () => bookkeeping.hardStale(),
    ensureFresh: () => bookkeeping.poke(),
    report: (ev) => fleetReporter.report(ev),
    forwardHeaders,
    registryFetch: doFetch,
    // Caller preferences (add-caller-preferences): the derived external
    // context carries the caller's reap window; a finished turn fires the
    // caller's completion callback (fire-and-forget, beside settlement).
    getReapWindow: (caller, slug) => store.prefsGet(caller.userId, slug)?.reapMinutes ?? null,
    onTurnComplete: (turn) => callbacks.dispatch(turn),
    chatability: (state) => (chatFaceRef ? chatFaceRef.chatable(state) : false),
    config: {
      // Runtime route through the registry proxy (ADR-0004's distribution
      // plane) — the facade never addresses runner origins directly.
      agentUrlFor: (agentPath) => `${registryUrl()}/agent${agentPath}/`,
    },
    ...(fetchImpl ? { upstreamFetch: fetchImpl } : {}),
    // Catalog signals (add-catalog-facets): the facet packs browse (public
    // listed view — private packs never enter the catalog) and the facade's
    // own usage ledger read back as the 7-day activity count.
    packsBrowseFetch: async () => (await packsInternalCall("/api/packs?pageSize=100")).packs ?? [],
    usageTurnsByAgent: (sinceMs) => store.usageTurnsByAgent(sinceMs),
  });
  face.register(app);

  const chatFace = createChatFace({
    core,
    store,
    logto: logtoAuth,
    agentState: (slug) => face.agentState(slug),
    resolveDeployment,
    forwardHeaders,
    hostSettle: async ({ packId, agentId, usageId, minutes, rateUsdPerMin }) => {
      const r = await packsInternalCall(
        `/api/packs/internal/deployments/${encodeURIComponent(packId)}/${encodeURIComponent(agentId)}/host-settle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ usage_id: usageId, minutes, rate_usd_per_min: rateUsdPerMin }),
        },
      );
      const doc = await r.json().catch(() => null);
      if (!r.ok) throw Object.assign(new Error(doc?.error || `host-settle ${r.status}`), { status: r.status });
      return doc;
    },
    sub2api,
    subsidyKey: env.WANXING_SUBSIDY_KEY || "",
    // Dedicated subsidy account (deploy decision 2026-10-09): the account
    // id configured directly — no key credential exists for it (upstream has
    // no admin-side key minting) and none is needed; wins over the key.
    subsidyUserId: Number(env.WANXING_SUBSIDY_USER_ID) || null,
    chat: {
      subsidyEnabled: /^(1|true|yes)$/i.test(String(env.WANXING_CHAT_SUBSIDY_ENABLED || "")),
      subsidyDailyMinutes: Number(env.WANXING_CHAT_SUBSIDY_DAILY_MINUTES || 10),
      rpmMax: Number(env.WANXING_CHAT_RPM || 6),
    },
    report: (ev) => fleetReporter.report(ev),
    config: {
      agentUrlFor: (agentPath) => `${registryUrl()}/agent${agentPath}/`,
    },
    ...(fetchImpl ? { upstreamFetch: fetchImpl } : {}),
  });
  chatFaceRef = chatFace;
  chatFace.register(app);

  // Missions (add-mission-definitions): the M2 task-definition face — the
  // four-tuple store, the planner dispatch over the same agent lane the a2a
  // face forwards through, the epoch writeback, and the console missions
  // routes. Planner slug is env-driven; unconfigured degrades visibly (the
  // console list answers plannerConfigured:false, submit refuses 503).
  const publicBase = () => (env.WANXING_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const missionsFace = createMissionsFace({
    store,
    core,
    resolveDeployment,
    forwardHeaders,
    config: {
      agentUrlFor: (agentPath) => `${registryUrl()}/agent${agentPath}/`,
      writebackUrlFor: (missionId) => `${publicBase()}/api/wanxing/v1/missions/${missionId}/writeback`,
    },
    report: (ev) => fleetReporter.report(ev),
    env,
    ...(fetchImpl ? { upstreamFetch: fetchImpl } : {}),
    log: (m) => console.log(`[wanxing:missions] ${m}`),
  });
  missionsFace.register(app, {
    requireToken: (req) => {
      const t = consoleToken();
      return Boolean(t) && req.headers.authorization === `Bearer ${t}`;
    },
    logtoAuth,
    sub2api,
  });

  // Deployer self-service (add-deployer-self-service, M3 ①): the console's
  // "deploy my agent" flow — facet packs surface under the verified identity,
  // deploy forwarding, and the share card. Unconfigured channel degrades 503.
  const selfService = createSelfServiceFace({
    store,
    sub2api,
    logtoAuth,
    listDeployments,
    requireToken: (req) => {
      const t = consoleToken();
      return Boolean(t) && req.headers.authorization === `Bearer ${t}`;
    },
    env,
    ...(fetchImpl ? { fetchImpl } : {}),
    subsidyOpen: () =>
      /^(1|true|yes)$/i.test(String(env.WANXING_CHAT_SUBSIDY_ENABLED || "")) &&
      Boolean(Number(env.WANXING_SUBSIDY_USER_ID) || env.WANXING_SUBSIDY_KEY) &&
      Boolean(sub2api && !sub2api.degraded()),
    log: (m) => console.log(`[wanxing:selfservice] ${m}`),
  });
  selfService.register(app);

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
    await core.settlePending((row) => chatFace.settleChatRow(row));
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
          ...(row.channel === "chat" ? { channel: "chat", settler: row.settler } : {}),
        },
        id: `facade-${row.id}`,
      });
    }
  };
  const sweep = setInterval(() => void sweepOnce().catch(() => {}), 60_000);
  sweep.unref?.();
  void core.settlePending((row) => chatFace.settleChatRow(row)).catch(() => {});

  return {
    core,
    store,
    face,
    chatFace,
    bookkeeping,
    diffDeployments,
    close() {
      clearInterval(sweep);
      fleetReporter.stop();
      if (!storeOpt) store.close();
    },
  };
}
