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
import { createClusterFace } from "./cluster.js";
import { createChatFace } from "./chat.js";
import { createBookkeepingCache, diffDeployments } from "./bookkeeping.js";
import { createFleetReporter } from "./fleet-report.js";
import { registerConsoleRoutes } from "./console.js";
import { createDeviceFace } from "./devices.js";
import { createMailboxFace, newTaskId } from "./mailbox.js";
import { createMissionsFace } from "./missions.js";
import { createSelfServiceFace } from "./selfservice.js";
import { registerPrefsRoutes } from "./prefs.js";
import { createCallbackDispatcher } from "./callbacks.js";
import { createLogtoAuth } from "./logto-auth.js";
import { createHash } from "node:crypto";
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
    (await bookkeeping.rows()).map((d) => ({ slug: slugFor(d.agentPath), agentPath: d.agentPath, packId: d.packId, agentId: d.agentId }));

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
    // Embed lane (add-embed-copilot-lane D3): product-line SPA clients of the
    // same tenant whose host-relayed ID tokens the chat lane additionally
    // accepts. Console gates never use this list.
    embedAudiences: env.WANXING_EMBED_AUDIENCES || "",
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
    // Fleet-memory platform seam (add-memory-visibility-console): the browser
    // brings a verified identity, the facade swaps in the fd-memory platform
    // credential. Null when unconfigured — the console memory faces then
    // respond 503 MEMORY_LANE_UNCONFIGURED and the web hides the affordance.
    memoryFetch: (() => {
      const memUrl = () => (env.FD_MEMORY_URL || "").replace(/\/+$/, "");
      const memToken = () => env.FD_MEMORY_PLATFORM_TOKEN || "";
      if (!memUrl() || !memToken()) return null;
      return async (p, init = {}) =>
        (fetchImpl ?? fetch)(`${memUrl()}${p}`, {
          ...init,
          headers: { ...(init.headers ?? {}), Authorization: `Bearer ${memToken()}` },
        });
    })(),
    log: (m) => console.log(`[wanxing:console] ${m}`),
  });

  // ── Desktop seat pairing (add-desktop-fleet-runner ③) ─────────────────────
  // Same dual gate as the console face; the ingest forward builds its own
  // observer POST (the console observerFetch is GET-shaped).
  const deviceGate = async (req, res) => {
    const t = consoleToken();
    if (t && req.headers.authorization === `Bearer ${t}`) return true;
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const ident = logtoAuth ? await logtoAuth.verifyIdToken(token).catch(() => null) : null;
    if (ident) {
      req.consoleIdentity = ident;
      return true;
    }
    res.status(401).json({ error: "console credential or verified identity required" });
    return false;
  };
  const observerPost = (() => {
    const observerUrl = () => (env.FLEET_OBSERVER_URL || "").replace(/\/+$/, "");
    const observerToken = () => env.FLEET_OBSERVER_TOKEN || "";
    return async (p, init = {}) => {
      const base = observerUrl();
      const tok = observerToken();
      if (!base || !tok) throw Object.assign(new Error("observer url/token not configured"), { status: 503 });
      return (fetchImpl ?? fetch)(`${base}${p}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${tok}`,
        },
      });
    };
  })();
  const deviceFace = createDeviceFace({
    store,
    gate: deviceGate,
    observerCall: observerPost,
    publicBase: () => (env.WANXING_PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
    log: (m) => console.log(`[wanxing:devices] ${m}`),
  });
  deviceFace.register(app);

  // ── Desktop seat mailbox (add-desktop-fleet-runner ④) ─────────────────────
  // Same per-seat credential the telemetry forward checks (the wxdesk- token
  // handed out at pairing); the pull/result routes ride the fleet prefix so
  // the seat's runner needs only the one base URL it already reports through.
  const seatAuth = (req) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token.startsWith("wxdesk-")) return null;
    const row = store.deviceByTokenHash(createHash("sha256").update(token).digest("hex"));
    return row ? { runnerId: row.runner_id } : null;
  };
  const mailboxFace = createMailboxFace({
    store,
    gate: deviceGate,
    seatAuth,
    log: (m) => console.log(`[wanxing:mailbox] ${m}`),
  });
  mailboxFace.register(app);

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
  // Cluster units (add-cluster-service-unit): the composite face resolves
  // against the a2a face's index/entry cache/member-turn core, while the a2a
  // face's catalog marker names the unit's endpoint — the late-bound ref
  // breaks the cycle the same way chatFaceRef does.
  let clusterRef = null;
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
      // Desktop-seat targets (add-desktop-fleet-runner ④): resolves the
      // seat's runner id when the entry is marked desktop_seat — the A2A
      // face then deposits the turn in the seat's mailbox instead of
      // proxying to an origin that is unreachable by design.
      seatTargetFor: async (agentPath) => {
        try {
          const r = await doFetch(`/api/agents${agentPath}`);
          if (!r.ok) return null;
          const entry = await r.json();
          return entry?.metadata?.desktop_seat === true && entry?.metadata?.runner_id ? entry.metadata.runner_id : null;
        } catch {
          return null; // registry hiccup → the normal proxy path (which will fail loudly)
        }
      },
      mailboxEnqueue: ({ runnerId, agentPath, text, callerEmail }) => {
        const taskId = newTaskId();
        store.mailboxEnqueue({ id: taskId, runnerId, agentPath, text, callerEmail, now: Date.now() });
        return taskId;
      },
    },
    ...(fetchImpl ? { upstreamFetch: fetchImpl } : {}),
    // Catalog signals (add-catalog-facets): the facet packs browse (public
    // listed view — private packs never enter the catalog) and the facade's
    // own usage ledger read back as the 7-day activity count.
    packsBrowseFetch: async () => (await packsInternalFetch("/api/packs?pageSize=100")).packs ?? [],
    // Cluster index (add-cluster-catalog-grouping): the public pack detail,
    // fetched only for multi-agent browse rows — the `cluster` declaration
    // lives in the manifest, which the browse row does not carry.
    packsDetailFetch: (id) => packsInternalFetch(`/api/packs/${encodeURIComponent(id)}`),
    usageTurnsByAgent: (sinceMs) => store.usageTurnsByAgent(sinceMs),
    // The unit endpoint on the cluster marker (add-cluster-service-unit):
    // late-bound so the two faces can be created in dependency order.
    clusterUnits: async () => (clusterRef ? clusterRef.units() : []),
  });
  const clusterFace = createClusterFace({
    core,
    a2a: {
      agentState: (slug) => face.agentState(slug),
      entryFor: (slug) => face.entryFor(slug),
      clusterMap: () => face.clusterMap(),
      runMemberTurn: (args) => face.runMemberTurn(args),
    },
    listDeployments,
    hardStale: () => bookkeeping.hardStale(),
    ensureFresh: () => bookkeeping.poke(),
    report: (ev) => fleetReporter.report(ev),
    env,
    log: (m) => console.log(`[wanxing:cluster] ${m}`),
  });
  clusterFace.register(app);
  clusterRef = clusterFace;
  face.register(app);

  const chatFace = createChatFace({
    core,
    store,
    logto: logtoAuth,
    agentState: (slug) => face.agentState(slug),
    resolveDeployment,
    forwardHeaders,
    // Visitor matters (matter-threads V2): the chat page's "我的事项" panel
    // reads the visitor's own matters through the packs internal surface —
    // scoped by the SAME opaque visitor scope the chat turns carry, so the
    // panel and the reception's tool face see exactly the same set.
    mattersList: async ({ packId, agentId, visitorScope }) => {
      const r = await packsInternalCall(
        `/api/packs/internal/matters/${encodeURIComponent(packId)}/${encodeURIComponent(agentId)}?visitor_scope=${encodeURIComponent(visitorScope)}`,
      );
      const doc = await r.json().catch(() => null);
      if (!r.ok) throw Object.assign(new Error(doc?.error || `matters ${r.status}`), { status: r.status });
      return doc.matters ?? [];
    },
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
      // Embed lane (add-embed-copilot-lane): anonymous is double-gated — this
      // global switch AND the per-agent deployer switch (wanxing_embed_settings,
      // managed on the console face). No embedSecret = anonymous inert.
      embed: {
        anonEnabled: /^(1|true|yes)$/i.test(String(env.WANXING_CHAT_ANON_ENABLED || "")),
        anonDailyMinutes: Number(env.WANXING_CHAT_ANON_DAILY_MINUTES || 3),
        embedSecret: env.WANXING_EMBED_SECRET || "",
        embedOrigins: String(env.WANXING_EMBED_ORIGINS || "").split(","),
        embedTtlMs: Number(env.WANXING_EMBED_TTL_MS || 24 * 3600_000),
        mintRpmMax: Number(env.WANXING_EMBED_MINT_RPM || 10),
      },
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
