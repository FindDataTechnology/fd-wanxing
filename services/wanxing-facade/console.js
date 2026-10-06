// ── Console management surface (⑤ increment 1: actions before identity) ────
//
// The deployer console's management routes, token-gated for now (the same
// console credential the web face already holds; Logto identity replaces the
// gate later — the route shapes stay). Pause/resume rides the registry entry
// metadata (the runner polls it, ADR: the flag is the single source of
// truth); allowlist management mirrors the paas packs-surface semantics the
// extraction stripped (add resolves email → sub2api user at add time).

import express from "express";


const ok = (res, body) => res.status(200).json(body);

export function registerConsoleRoutes(app, {
  requireToken, // (req) => boolean service-token gate
  logtoAuth = null, // createLogtoAuth() — the identity gate (⑤ increment 2)
  bookkeeping, // { rows(), resolve(slug) } — the snapshot cache
  store, // wanxing store (allowlist*)
  sub2api, // client or null
  registryFetch, // (path, init) → Response against the registry
  packsInternalFetch = null, // (path, init) → Response against the packs surface (config proxy)
  observerFetch = null, // (path) → Response against fleet-observer (service credential inside)
  log = null,
}) {
  const say = log ?? (() => {});

  // Pause/resume: registry metadata is the truth (runner polls ≤pollSecs).
  // Mirror of paas lib/agent-serving.js setAgentPaused (minimal copy, keep in
  // lockstep until ②-收敛).
  const setPaused = async (agentPath, paused) => {
    const r = await registryFetch(`/api/agents${agentPath}`);
    if (!r.ok) throw Object.assign(new Error(`registry GET ${agentPath} failed (${r.status})`), { status: 502 });
    const entry = await r.json();
    if (!entry || typeof entry !== "object") throw Object.assign(new Error(`registry entry unreadable`), { status: 502 });
    entry.metadata = { ...(entry.metadata ?? {}), paused: paused === true };
    if (!paused) delete entry.metadata.paused;
    const up = await registryFetch(`/api/agents${agentPath}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!up.ok) {
      // The register route is the create-side twin of the upsert.
      const reg = await registryFetch("/api/agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!reg.ok) throw Object.assign(new Error(`registry write failed (${up.status}/${reg.status})`), { status: 502 });
    }
    return { agentPath, paused: paused === true };
  };

  // Dual gate: the ops service token, or a verified Logto identity (email
  // allowlist, fail-closed — see logto-auth.js).
  const gate = async (req, res) => {
    if (requireToken(req)) return true;
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const ident = logtoAuth ? await logtoAuth.verifyIdToken(token).catch(() => null) : null;
    if (ident) {
      req.consoleIdentity = ident;
      return true;
    }
    res.status(401).json({ error: "console credential or verified identity required" });
    return false;
  };

  // PKCE exchange proxy: the static face cannot call the tenant token
  // endpoint cross-origin; the facade exchanges and returns the verified
  // identity bound to the ID token.
  if (logtoAuth?.configured) {
    app.post("/api/wanxing/v1/console/auth/exchange", express.json({ limit: "4kb" }), async (req, res) => {
      const { code, verifier, redirect_uri: redirectUri } = req.body ?? {};
      if (!code || !verifier || !redirectUri) return res.status(400).json({ error: "code, verifier, redirect_uri required" });
      try {
        const out = await logtoAuth.exchangeCode({ code, verifier, redirectUri });
        res.json(out);
      } catch (e) {
        res.status(Number.isInteger(e?.status) ? e.status : 502).json({ error: String(e?.message || e) });
      }
    });
    app.get("/api/wanxing/v1/console/auth/config", (_req, res) => {
      res.json({ configured: true, app_id: logtoAuth.appId, endpoint: logtoAuth.endpoint });
    });
  }
  // Session endpoints are a stable surface: registered always, 503 when
  // identity is not configured on this deployment.
  const needIdentity = (res) => {
    if (logtoAuth?.configured) return false;
    res.status(503).json({ error: "identity not configured on this deployment" });
    return true;
  };
  // Silent renewal: same fail-closed gate as login (the refreshed id_token
  // is re-verified — a refresh grant never lowers the door). Rotation-aware
  // response: whichever refresh_token the tenant issued is the one returned;
  // absent means the tenant did not rotate and the client keeps its current.
  app.post("/api/wanxing/v1/console/auth/refresh", express.json({ limit: "4kb" }), async (req, res) => {
    if (needIdentity(res)) return;
    const { refresh_token: refreshToken } = req.body ?? {};
    if (!refreshToken) return res.status(400).json({ error: "refresh_token required" });
    try {
      const doc = await logtoAuth.refreshGrant({ refreshToken });
      const ident = await logtoAuth.verifyIdToken(doc.id_token);
      if (!ident) throw Object.assign(new Error("identity refused (allowlist or verification)"), { status: 403 });
      res.json({ id_token: doc.id_token, refresh_token: doc.refresh_token ?? refreshToken, email: ident.email });
    } catch (e) {
      res.status(Number.isInteger(e?.status) ? e.status : 502).json({ error: String(e?.message || e) });
    }
  });
  // Logout hygiene (RFC 7009): revocation is cleanup, never a gate — an
  // unreachable tenant still lets the client clear local state.
  app.post("/api/wanxing/v1/console/auth/revoke", express.json({ limit: "4kb" }), async (req, res) => {
    if (needIdentity(res)) return;
    const { token } = req.body ?? {};
    if (!token) return res.status(400).json({ error: "token required" });
    try {
      await logtoAuth.revokeToken(token);
    } catch { /* best-effort by contract */ }
    res.json({ ok: true });
  });

  // ── Fleet reads under the console gate (add-console-session-continuity) ───
  //
  // The web face's nginx forwards /api/fleet/ here; the observer stays
  // credential-only. Browser identity is verified, then swapped for the
  // observer service credential. An upstream 401 must NOT leak (the SPA would
  // misread the observer's credential challenge as "session expired"), so
  // upstream failures become 502 diagnostics.
  const fleetForward = (upstreamPathOf) => async (req, res) => {
    if (!(await gate(req, res))) return;
    let r;
    try {
      r = await observerFetch(upstreamPathOf(req));
    } catch (e) {
      const status = Number.isInteger(e?.status) ? e.status : 502;
      return res.status(status === 503 ? 503 : 502).json({ error: `fleet observer unavailable: ${e?.message || e}` });
    }
    const body = Buffer.from(await r.arrayBuffer());
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(body);
  };
  if (observerFetch) {
    app.get("/api/fleet/v1/board", fleetForward(() => "/api/fleet/v1/board"));
    app.get("/api/fleet/v1/agents/:slug/timeline", fleetForward((req) => {
      const q = new URL(req.originalUrl, "http://local").search;
      return `/api/fleet/v1/agents/${encodeURIComponent(req.params.slug)}/timeline${q}`;
    }));
  }

  app.get("/api/wanxing/v1/console/deployments", async (req, res) => {
    if (!(await gate(req, res))) return;
    let rows;
    try {
      rows = await bookkeeping.rows();
    } catch (e) {
      return res.status(503).json({ error: { code: "DEPLOYMENT_SOURCE_UNAVAILABLE", message: String(e?.message || e) } });
    }
    const out = [];
    for (const d of rows.slice(0, 200)) {
      let name = null, visibility = null, paused = false;
      try {
        const r = await registryFetch(`/api/agents${d.agentPath}`);
        if (r.ok) {
          const e = await r.json();
          name = e?.name ?? null;
          visibility = e?.visibility === "private" ? "private" : "public";
          paused = e?.metadata?.paused === true;
        }
      } catch { /* best-effort enrichment */ }
      out.push({
        slug: String(d.agentPath).replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase(),
        agentPath: d.agentPath,
        packId: d.packId,
        agentId: d.agentId,
        version: d.version ?? null,
        name, visibility, paused,
      });
    }
    return ok(res, { deployments: out });
  });

  const pauseAction = (paused) => async (req, res) => {
    if (!(await gate(req, res))) return;
    const row = await bookkeeping.resolve(req.params.slug).catch(() => null);
    if (!row) return res.status(404).json({ error: "deployment not found" });
    try {
      const out = await setPaused(row.agentPath, paused);
      say(`console: ${req.params.slug} ${paused ? "paused" : "resumed"}`);
      return ok(res, { ...out, effectiveWithinSecs: 300 });
    } catch (e) {
      return res.status(Number.isInteger(e?.status) ? e.status : 502).json({ error: String(e?.message || e) });
    }
  };
  app.post("/api/wanxing/v1/console/deployments/:slug/pause", pauseAction(true));
  app.post("/api/wanxing/v1/console/deployments/:slug/resume", pauseAction(false));

  // ── Service config proxy (agent-service-config) ───────────────────────────
  // The console is a thin door: it verifies the browser's identity, then calls
  // the packs surface's INTERNAL twin with the acting user — deployer-or-admin
  // enforcement, shape validation, and model lane checks all live there (the
  // manifest is only readable on the packs side, so nothing is duplicated
  // here). The ops service token has no actor: it may read, never write.
  const configForward = (method) => async (req, res) => {
    if (!(await gate(req, res))) return;
    // Both methods need an actor: reads carry it for the deploys' deployer
    // rule on the packs side, writes for the same rule plus audit. The ops
    // service token has no actor — the config face is identity-only.
    if (!req.consoleIdentity) {
      return res.status(400).json({ error: "a verified identity is required for service config (the ops token carries no actor)" });
    }
    const row = await bookkeeping.resolve(req.params.slug).catch(() => null);
    if (!row) return res.status(404).json({ error: "deployment not found" });
    let r;
    try {
      r = await packsInternalFetch(
        `/api/packs/internal/deployments/${encodeURIComponent(row.packId)}/${encodeURIComponent(row.agentId)}/config`,
        {
          method,
          headers: {
            ...(req.consoleIdentity?.email ? { "x-acting-user": req.consoleIdentity.email } : {}),
            // The tenant issues no groups claim today (username-only tokens,
            // live finding); passed through the moment it does — until then
            // the packs-side admin path needs an actor with groups.
            ...(Array.isArray(req.consoleIdentity?.groups) ? { "x-acting-groups": req.consoleIdentity.groups.join(",") } : {}),
            ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
          },
          ...(method === "PUT" ? { body: JSON.stringify(req.body ?? {}) } : {}),
        },
      );
    } catch (e) {
      return res.status(503).json({ error: `packs surface unavailable: ${String(e?.message || e)}` });
    }
    const body = await r.json().catch(() => ({}));
    if (method === "PUT" && r.ok) say(`console: ${req.params.slug} config updated by ${req.consoleIdentity?.email} (${Object.keys(req.body ?? {}).join(", ") || "no-op"})`);
    return res.status(r.status).json(body);
  };
  if (packsInternalFetch) {
    app.get("/api/wanxing/v1/console/deployments/:slug/config", configForward("GET"));
    app.put("/api/wanxing/v1/console/deployments/:slug/config", express.json({ limit: "64kb" }), configForward("PUT"));
  }

  app.get("/api/wanxing/v1/console/deployments/:slug/callers", async (req, res) => {
    if (!(await gate(req, res))) return;
    return ok(res, { callers: store.allowlistList(req.params.slug) });
  });

  app.post("/api/wanxing/v1/console/deployments/:slug/callers", express.json({ limit: "16kb" }), async (req, res) => {
    if (!(await gate(req, res))) return;
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ error: "email required" });
    if (!sub2api || sub2api.degraded()) return res.status(503).json({ error: "billing plane not configured — allowlists are inactive" });
    let account;
    try {
      account = await sub2api.findUserByEmail(email);
    } catch (e) {
      return res.status(502).json({ error: `billing account lookup failed: ${e.message}` });
    }
    if (!account) {
      return res.status(404).json({
        error: "no sub2api account for that email yet — the caller signs in once at the billing panel (Logto) to create it",
        code: "NO_SUB2API_ACCOUNT",
      });
    }
    store.allowlistAdd(req.params.slug, account.userId, email);
    return ok(res, { ok: true, caller: { userId: account.userId, email } });
  });

  app.delete("/api/wanxing/v1/console/deployments/:slug/callers", express.json({ limit: "16kb" }), async (req, res) => {
    if (!(await gate(req, res))) return;
    const userId = Number(req.body?.userId ?? req.query?.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: "userId required" });
    store.allowlistRemove(req.params.slug, userId);
    return ok(res, { ok: true });
  });
}
