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
  requireToken, // () => boolean gate (bearer check done by caller's helper)
  bookkeeping, // { rows(), resolve(slug) } — the snapshot cache
  store, // wanxing store (allowlist*)
  sub2api, // client or null
  registryFetch, // (path, init) → Response against the registry
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

  app.get("/api/wanxing/v1/console/deployments", async (req, res) => {
    if (!requireToken(req)) return res.status(401).json({ error: "console credential required" });
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
    if (!requireToken(req)) return res.status(401).json({ error: "console credential required" });
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

  app.get("/api/wanxing/v1/console/deployments/:slug/callers", async (req, res) => {
    if (!requireToken(req)) return res.status(401).json({ error: "console credential required" });
    return ok(res, { callers: store.allowlistList(req.params.slug) });
  });

  app.post("/api/wanxing/v1/console/deployments/:slug/callers", express.json({ limit: "16kb" }), async (req, res) => {
    if (!requireToken(req)) return res.status(401).json({ error: "console credential required" });
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
    if (!requireToken(req)) return res.status(401).json({ error: "console credential required" });
    const userId = Number(req.body?.userId ?? req.query?.userId);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: "userId required" });
    store.allowlistRemove(req.params.slug, userId);
    return ok(res, { ok: true });
  });
}
