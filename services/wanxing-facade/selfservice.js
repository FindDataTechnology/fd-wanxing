// ── Deployer self-service (add-deployer-self-service, M3 slice ①) ───────────
//
// The 场景B story "部署 → 得到可分享的对话页 URL" as a console flow: the
// facade speaks to the facet packs surface AS the verified console identity
// (the same forwarded-identity semantics 壹座's gateway proxy uses), lists
// the deployer's own published packs, deploys on their instruction, and
// assembles the share card (chat URL + chatability + allowance guidance).
// The facet contract is consumed, never modified; the channel degrades
// visibly when unconfigured — never a silent empty list.

import express from "express";

export function createSelfServiceFace({
  store,
  sub2api = null,
  logtoAuth,
  requireToken,
  env = process.env,
  fetchImpl = fetch,
  // Deployments snapshot (add-catalog-facets): async () → [{ slug, agentPath,
  // packId }] — the in-service signal for the directory source and the
  // greenfield gate.
  listDeployments = null,
  // Chatability inputs (chat face's own derivation, re-composed here from the
  // same store/env facts — one definition each side, same inputs).
  subsidyOpen = () => false,
  webBase = "",
  log = () => {},
}) {
  const facetBase = () => String(env.FACET_BASE_URL || "").replace(/\/+$/, "");
  const facetToken = () => String(env.FACET_INTERNAL_TOKEN || "");
  const channelReady = () => Boolean(facetBase() && facetToken());
  const shareBase = () => webBase || String(env.WANXING_WEB_BASE_URL || "https://wanxing.finddatatech.cloud").replace(/\/+$/, "");

  // The forwarded-identity call: facet trusts the internal credential and
  // treats the forwarded user as the caller (facet/identity.js semantics).
  const facetCall = async (identity, path, init = {}) => {
    const headers = {
      "x-facet-user": Buffer.from(JSON.stringify({ email: identity.email, groups: identity.groups ?? [] })).toString("base64url"),
      "x-facet-token": facetToken(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    };
    return fetchImpl(`${facetBase()}${path}`, { ...init, headers });
  };

  const gate = async (req, res) => {
    if (requireToken(req)) return { ops: true };
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const ident = logtoAuth ? await logtoAuth.verifyIdToken(token).catch(() => null) : null;
    if (ident) {
      req.consoleIdentity = ident;
      return { ops: false, email: String(ident.email || "").toLowerCase(), identity: ident };
    }
    res.status(401).json({ error: "console credential or verified identity required" });
    return null;
  };

  const slugFor = (agentPath) => String(agentPath || "").replace(/^\/+/, "").replace(/[^A-Za-z0-9._-]+/g, "-").toLowerCase();

  // Serving-agent summary shared by my/packs and the directory source
  // (add-catalog-facets): one definition of deployability + the wizard's
  // model hint. modelWhitelist rides only when declared — an empty array
  // would read as "no model allowed".
  const deployableAgentsOf = (detail) =>
    (detail?.manifest?.agents ?? [])
      .filter((a) => a?.serving)
      .map((a) => ({ id: a.id, name: a.name, ...(a.serving.modelWhitelist ? { modelWhitelist: a.serving.modelWhitelist } : {}) }));

  // Directory detail cache (add-catalog-facets): pack id → deployable agents,
  // 60s TTL — the per-pack detail fetch is the same call my/packs makes per
  // request; the directory source makes it once per window instead.
  const dirCache = new Map(); // packId → { at, agents }
  const directoryAgents = async (identity, packId) => {
    const cached = dirCache.get(packId);
    if (cached && Date.now() - cached.at < 60_000) return cached.agents;
    const agents = await facetCall(identity, `/api/packs/${encodeURIComponent(packId)}`)
      .then(async (r) => (r.ok ? deployableAgentsOf(await r.json()) : []))
      .catch(() => []); // detail failure lists the pack as not-deployable
    dirCache.set(packId, { at: Date.now(), agents });
    return agents;
  };

  // Chatability verdict for the share card: public + unpaused + the chat
  // waterfall open (platform subsidy or the deployer's own allowance).
  const chatVerdict = (entry) => {
    if (!entry) return { chatable: false, reason: "未部署或部署信息不可达" };
    if (entry.visibility === "private") return { chatable: false, reason: "pack 为私有——公开后才可对话（在壹座重新发布可见性）" };
    if (entry.paused === true) return { chatable: false, reason: "agent 已暂停——恢复后即可对话" };
    if (subsidyOpen()) return { chatable: true, reason: "平台补贴支付访客对话" };
    const cap = store.hostAllowanceGet(entry.slug);
    if (!cap) return { chatable: false, reason: "平台补贴未开且未配置部署者额度——设置 host allowance 后开放对话" };
    const remaining = Math.max(0, cap.limitMinutes - store.hostAllowanceUsed(entry.slug));
    if (remaining <= 0) return { chatable: false, reason: "部署者额度已用尽——补充后开放对话" };
    return { chatable: true, reason: `部署者额度支付访客对话（余 ${remaining} 分钟）` };
  };

  // The deploy core (add-deploy-collections extraction): everything between
  // the request gate and the response — validation, ownership/greenfield,
  // payload assembly, forward, slug mapping. Returns {status, body}; the
  // single-pack route and the bundle deploy both ride it.
  const deployPackCore = async (who, packId, body) => {
    const billingKey = String(body?.billingKey || "").trim();
    if (!billingKey || !/^sk-/.test(billingKey)) {
      return { status: 400, body: { error: "billingKey is required (your sub2api key, sk-…) — the deployment's turns bill against it" } };
    }
    const notifyChannel = typeof body?.notifyChannel === "string" && body.notifyChannel.trim() ? body.notifyChannel.trim() : null;

    // Wizard payload (add-deploy-wizard / M4①): `agents` names the serving
    // agents to deploy (subset selection — facet validates membership);
    // models/budgets/rhythms are per-agent deploy-time initial config.
    // Facet is the single validation authority: these ride the forward
    // verbatim, its structured refusals pass through. The facade's own gate
    // is only the cheap shape guard — a non-object or array would otherwise
    // sail through JSON.stringify into a confusing facet 400.
    for (const key of ["models", "budgets", "rhythms"]) {
      const v = body?.[key];
      if (v !== undefined && (v === null || typeof v !== "object" || Array.isArray(v))) {
        return { status: 400, body: { error: `${key} must be an object of { agentId: value }` } };
      }
    }
    const agentsBody = body?.agents;
    if (agentsBody !== undefined && (!Array.isArray(agentsBody) || agentsBody.length === 0 || agentsBody.some((a) => typeof a !== "string" || !a))) {
      return { status: 400, body: { error: "agents must be a non-empty array of serving agent ids" } };
    }

    // Ownership: the facet detail is the truth (browse rows can lag).
    let detail;
    try {
      const r = await facetCall(who.identity, `/api/packs/${encodeURIComponent(packId)}`);
      if (r.status === 404) return { status: 404, body: { error: "pack not found" } };
      if (!r.ok) throw Object.assign(new Error(`facet detail ${r.status}`), { status: 502 });
      detail = await r.json();
    } catch (e) {
      return { status: Number.isInteger(e?.status) ? e.status : 502, body: { error: `packs surface unreachable: ${e?.message || e}` } };
    }
    let foreignGreenfield = false;
    if (String(detail?.authorEmail || "").toLowerCase() !== who.email) {
      // Foreign packs (add-catalog-facets, M4②): private/unlisted keep the
      // not-found answer — foreign means public listed here. A public
      // foreign pack deploys GREENFIELD-only: already-in-service refuses,
      // so this face can never take over someone's live deployment
      // (upgrades belong to the author's my/packs path by construction).
      if (detail.visibility === "private" || detail.unlisted === true) {
        return { status: 404, body: { error: "pack not found" } };
      }
      if (!listDeployments) {
        return { status: 503, body: { error: "deployment snapshot not wired — foreign deploys cannot be gated greenfield" } };
      }
      let inService = false;
      try {
        inService = (await listDeployments()).some((d) => d.packId === packId);
      } catch (e) {
        return { status: 503, body: { error: `deployment snapshot unavailable — greenfield cannot be verified: ${e?.message || e}` } };
      }
      if (inService) {
        return { status: 400, body: { error: "该 pack 已在役——升级/重部署走作者侧（「我的 pack」路径），本面不接管他人在役部署", code: "IN_SERVICE" } };
      }
      foreignGreenfield = true;
    }
    const serving = (detail?.manifest?.agents ?? []).filter((a) => a?.serving);
    if (serving.length === 0) {
      return { status: 400, body: { error: "no serving-contract agent in this pack — 只有带 serving 契约的 agent 可部署为服务" } };
    }
    const version = Number.isInteger(body?.version) && body.version > 0 ? body.version : (detail.version ?? null);
    if (!version) return { status: 400, body: { error: "version could not be resolved" } };

    // One key backs every DEPLOYED agent (the deployer's own account). The
    // mapping follows the selection — an absent `agents` maps over every
    // serving agent exactly as before (self-service v1 contract).
    const selected = Array.isArray(agentsBody) ? agentsBody.map(String) : serving.map((a) => a.id);
    const fwdBody = {
      ...(agentsBody !== undefined ? { agents: selected } : {}),
      billingKeys: Object.fromEntries(selected.map((id) => [id, billingKey])),
      ...(notifyChannel ? { notifyChannel: Object.fromEntries(selected.map((id) => [id, notifyChannel])) } : {}),
      ...(body?.models !== undefined ? { models: body.models } : {}),
      ...(body?.budgets !== undefined ? { budgets: body.budgets } : {}),
      ...(body?.rhythms !== undefined ? { rhythms: body.rhythms } : {}),
    };
    try {
      // A greenfield foreign deploy bridges the console's operator-granted
      // deployer credential into the facet's creator gate: the allowlisted
      // identity vouches, the facet's own author-or-creator rule still
      // applies (and its structured refusal passes through verbatim below).
      const fwdIdentity = foreignGreenfield
        ? { ...who.identity, groups: [...new Set([...(who.identity.groups ?? []), "creators"])] }
        : who.identity;
      const r = await facetCall(fwdIdentity, `/api/packs/${encodeURIComponent(packId)}/versions/${version}/deploy`, {
        method: "POST",
        body: JSON.stringify(fwdBody),
      });
      const doc = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Facet's structured refusal passes through verbatim (balance gate,
        // model lane validation, …) — the deployer sees the real reason.
        return { status: r.status, body: doc ?? { error: `facet deploy ${r.status}` } };
      }
      log(`selfservice: ${who.email} deployed ${packId} v${version} (${selected.join(",")})`);
      return {
        status: 200,
        body: {
          deployed: (doc?.deployed ?? []).map((d) => ({
            agentId: d.agentId,
            agentPath: d.agentPath,
            slug: slugFor(d.agentPath),
          })),
          version,
        },
      };
    } catch (e) {
      return { status: 502, body: { error: `deploy forward failed: ${e?.message || e}` } };
    }
  };

  // ── Collections (add-deploy-collections, M4③) ──────────────────────────────
  // A collection is a REFERENCE list — {packId, agentId?, suggestedConfig?}
  // entries, pack stays the atomic supply unit — never a content copy and
  // never an execution surface. Cheap shape guards here; the facet remains
  // the validation authority when an entry actually deploys.
  const ENTRY_LIMIT = 20;
  const SUGGESTED_KEYS = new Set(["model", "budgetMinutes", "rhythm"]);
  const entriesError = (msg) => ({ status: 400, body: { error: msg } });
  const validateEntries = (list) => {
    if (!Array.isArray(list)) return "entries must be an array of { packId, agentId?, suggestedConfig? }";
    if (list.length > ENTRY_LIMIT) return `entries exceed the ${ENTRY_LIMIT}-entry bound`;
    const seen = new Set();
    for (const e of list) {
      if (!e || typeof e !== "object" || Array.isArray(e)) return "each entry must be an object";
      if (typeof e.packId !== "string" || !e.packId) return "each entry needs a packId string";
      if (e.agentId !== undefined && (typeof e.agentId !== "string" || !e.agentId)) return "entry.agentId must be a non-empty string when present";
      const key = `${e.packId}\u0000${e.agentId ?? ""}`;
      if (seen.has(key)) return `entry ${e.packId}${e.agentId ? "/" + e.agentId : ""} is listed twice — references are unique`;
      seen.add(key);
      if (e.suggestedConfig !== undefined) {
        if (!e.agentId) return `entry ${e.packId}: suggestedConfig requires agentId — name the agent it configures`;
        if (!e.suggestedConfig || typeof e.suggestedConfig !== "object" || Array.isArray(e.suggestedConfig)) {
          return `entry ${e.packId}: suggestedConfig must be an object of { model?, budgetMinutes?, rhythm? }`;
        }
        for (const k of Object.keys(e.suggestedConfig)) {
          if (!SUGGESTED_KEYS.has(k)) return `entry ${e.packId}: suggestedConfig has unknown key '${k}' (model / budgetMinutes / rhythm only)`;
        }
        const sc = e.suggestedConfig;
        if (sc.model !== undefined && (typeof sc.model !== "string" || !sc.model)) return `entry ${e.packId}: suggestedConfig.model must be a model identifier string`;
        if (sc.budgetMinutes !== undefined && (!Number.isInteger(sc.budgetMinutes) || sc.budgetMinutes < 1 || sc.budgetMinutes > 120)) {
          return `entry ${e.packId}: suggestedConfig.budgetMinutes must be a whole number of minutes (1–120)`;
        }
        if (sc.rhythm !== undefined && !Array.isArray(sc.rhythm)) return `entry ${e.packId}: suggestedConfig.rhythm must be a rhythm entries array`;
      }
    }
    return null;
  };

  // Entry resolution for detail/share views: cached browse (name, version,
  // curation), cached serving agents (agent names), snapshot (in-service).
  const resolveEntries = async (identity, entries) => {
    const browse = await facetCall(identity, "/api/packs?pageSize=100")
      .then(async (r) => (r.ok ? await r.json() : null))
      .catch(() => null);
    const byId = new Map((browse?.packs ?? []).map((p) => [p.id, p]));
    let inServiceIds = new Set();
    try {
      if (listDeployments) inServiceIds = new Set((await listDeployments()).map((d) => d.packId));
    } catch { /* snapshot failure: no in-service answer rather than a wrong one */ }
    const out = [];
    for (const e of entries) {
      const pack = byId.get(e.packId) ?? null;
      let agentName = null;
      if (pack) {
        const agents = await directoryAgents(identity, e.packId).catch(() => []);
        agentName = e.agentId ? (agents.find((a) => a.id === e.agentId)?.name ?? null) : null;
      }
      out.push({
        packId: e.packId,
        ...(e.agentId ? { agentId: e.agentId } : {}),
        packName: pack?.name ?? null,
        packVersion: pack?.version ?? null,
        ...(pack?.category ? { category: pack.category } : {}),
        ...(pack?.featured ? { featured: true } : {}),
        inService: inServiceIds.has(e.packId),
        ...(e.agentId && agentName ? { agentName } : {}),
        ...(e.suggestedConfig ? { suggestedConfig: e.suggestedConfig } : {}),
      });
    }
    return out;
  };

  function register(app) {
    const needChannel = (res) => {
      if (channelReady()) return false;
      res.status(503).json({ error: "deployer self-service is not configured (FACET_BASE_URL / FACET_INTERNAL_TOKEN) — ask the operator" });
      return true;
    };

    app.get("/api/wanxing/v1/console/my/packs", async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity — my/packs is for a verified deployer" });
      if (needChannel(res)) return;

      let browse;
      try {
        const r = await facetCall(who.identity, "/api/packs?includeUnlisted=1&pageSize=100");
        if (!r.ok) throw Object.assign(new Error(`facet browse ${r.status}`), { status: 502 });
        browse = await r.json();
      } catch (e) {
        return res.status(Number.isInteger(e?.status) ? e.status : 502).json({ error: `packs surface unreachable: ${e?.message || e}` });
      }
      const mine = (browse?.packs ?? []).filter((p) => String(p.authorEmail || "").toLowerCase() === who.email);

      // Serving-agent summary needs each pack's manifest (agents[].serving).
      const out = [];
      for (const p of mine) {
        let agents = [];
        try {
          const r = await facetCall(who.identity, `/api/packs/${encodeURIComponent(p.id)}`);
          if (r.ok) {
            agents = deployableAgentsOf(await r.json());
          }
        } catch { /* detail failure lists the pack as not-deployable */ }
        out.push({
          id: p.id, name: p.name, version: p.version, visibility: p.visibility,
          unlisted: p.unlisted === true, updatedAt: p.publishedAt ?? p.createdAt ?? null,
          deployableAgents: agents,
          deployable: agents.length > 0,
        });
      }
      res.json({ packs: out });
    });

    // The deploy wizard's directory source (add-catalog-facets, M4② 挑得准):
    // public listed packs joined with serving agents and their in-service
    // state. Same facet browse the market renders, seen through the deployer
    // console — discovery feeding deployment.
    app.get("/api/wanxing/v1/console/catalog/packs", async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity — the directory source is for a verified deployer" });
      if (needChannel(res)) return;
      if (!listDeployments) return res.status(503).json({ error: "deployment snapshot not wired on this deployment" });

      let browse;
      try {
        const r = await facetCall(who.identity, "/api/packs?pageSize=100");
        if (!r.ok) throw Object.assign(new Error(`facet browse ${r.status}`), { status: 502 });
        browse = await r.json();
      } catch (e) {
        return res.status(Number.isInteger(e?.status) ? e.status : 502).json({ error: `packs surface unreachable: ${e?.message || e}` });
      }
      const packs = browse?.packs ?? [];
      if (packs.length >= 100) log(`selfservice: directory browse hit the 100-pack page cap (${packs.length} listed)`);
      let rows;
      try {
        rows = await listDeployments();
      } catch (e) {
        // The in-service badge is load-bearing (it gates selection); a failed
        // snapshot would mislabel every pack as greenfield — refuse instead.
        return res.status(503).json({ error: `deployment snapshot unavailable: ${e?.message || e}` });
      }
      const inService = new Set(rows.map((d) => d.packId));

      const out = [];
      for (const p of packs) {
        const agents = await directoryAgents(who.identity, p.id);
        out.push({
          id: p.id,
          name: p.name,
          version: p.version,
          category: p.category ?? "",
          featured: p.featured === true,
          deployableAgents: agents,
          deployable: agents.length > 0,
          deployed: inService.has(p.id),
        });
      }
      res.json({ packs: out });
    });

    app.post("/api/wanxing/v1/console/my/packs/:id/deploy", express.json({ limit: "16kb" }), async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity — deploy is for a verified deployer" });
      if (needChannel(res)) return;

      const out = await deployPackCore(who, req.params.id, req.body ?? {});
      res.status(out.status).json(out.body);
    });

    // The share card: everything a fresh deployer asks next — where is my
    // page, can visitors talk, who pays. Assembled from live faces, no store.
    app.get("/api/wanxing/v1/console/my/deployments/:slug/share", async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      const slug = String(req.params.slug || "");
      const cap = store.hostAllowanceGet(slug);
      const verdict = chatVerdict({ slug, visibility: "public", paused: false });
      res.json({
        slug,
        chatUrl: `${shareBase()}/#/chat/${encodeURIComponent(slug)}`,
        chatable: verdict.chatable,
        chatableReason: verdict.reason,
        allowance: cap ? {
          limitMinutes: cap.limitMinutes,
          remainingMinutes: Math.max(0, cap.limitMinutes - store.hostAllowanceUsed(slug)),
          updatedBy: cap.updatedBy,
        } : null,
      });
    });

    // ── Collections: console CRUD (add-deploy-collections, M4③) ─────────────
    app.get("/api/wanxing/v1/console/collections", async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity — collections are for a verified deployer" });
      res.json({
        collections: store.collectionsForOwner(who.email).map((c) => ({
          id: c.id, name: c.name, description: c.description, visibility: c.visibility,
          entries: c.entries.length, updatedAt: c.updatedAt,
        })),
      });
    });

    app.post("/api/wanxing/v1/console/collections", express.json({ limit: "16kb" }), async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity — collections are for a verified deployer" });
      const name = String(req.body?.name || "").trim();
      if (!name || name.length > 60) return res.status(400).json({ error: "name is required (≤60 chars)" });
      const description = String(req.body?.description ?? "").slice(0, 300);
      const visibility = req.body?.visibility === "public" ? "public" : "private";
      const c = store.collectionInsert({ ownerEmail: who.email, name, description, visibility });
      log(`selfservice: ${who.email} created collection ${c.id} (${visibility})`);
      res.json({ collection: c });
    });

    app.get("/api/wanxing/v1/console/collections/:id", async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity" });
      const c = store.collectionGet(req.params.id);
      if (!c || c.ownerEmail !== who.email) return res.status(404).json({ error: "collection not found" });
      if (needChannel(res)) return;
      res.json({ collection: { ...c, entries: await resolveEntries(who.identity, c.entries) } });
    });

    app.put("/api/wanxing/v1/console/collections/:id", express.json({ limit: "32kb" }), async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity" });
      const c = store.collectionGet(req.params.id);
      if (!c || c.ownerEmail !== who.email) return res.status(404).json({ error: "collection not found" });
      const { name, description, visibility } = req.body ?? {};
      if (name !== undefined && (!String(name).trim() || String(name).length > 60)) {
        return res.status(400).json({ error: "name must be 1–60 chars when provided" });
      }
      if (visibility !== undefined && visibility !== "private" && visibility !== "public") {
        return res.status(400).json({ error: "visibility must be private or public" });
      }
      const updated = store.collectionUpdate(c.id, {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(description !== undefined ? { description: String(description ?? "").slice(0, 300) } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
      });
      res.json({ collection: updated });
    });

    app.put("/api/wanxing/v1/console/collections/:id/entries", express.json({ limit: "64kb" }), async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity" });
      const c = store.collectionGet(req.params.id);
      if (!c || c.ownerEmail !== who.email) return res.status(404).json({ error: "collection not found" });
      const err = validateEntries(req.body?.entries);
      if (err) return res.status(400).json({ error: err });
      const updated = store.collectionUpdate(c.id, { entries: req.body.entries });
      log(`selfservice: ${who.email} set ${req.body.entries.length} entries on ${c.id}`);
      res.json({ collection: { ...updated, entries: await resolveEntries(who.identity, updated.entries) } });
    });

    app.delete("/api/wanxing/v1/console/collections/:id", async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity" });
      const c = store.collectionGet(req.params.id);
      if (!c || c.ownerEmail !== who.email) return res.status(404).json({ error: "collection not found" });
      store.collectionDelete(c.id);
      res.json({ deleted: true });
    });

    // Bundle deploy (M4③b): one billing key, every entry rides the deploy
    // core sequentially — per-entry verdicts, in-service skips never block.
    app.post("/api/wanxing/v1/console/collections/:id/deploy", express.json({ limit: "4kb" }), async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity — bundle deploys are for a verified deployer" });
      if (needChannel(res)) return;
      const c = store.collectionGet(req.params.id);
      if (!c || (c.ownerEmail !== who.email && c.visibility !== "public")) {
        return res.status(404).json({ error: "collection not found" });
      }
      if (c.entries.length === 0) return res.status(400).json({ error: "the collection is empty — add entries first" });
      const billingKey = String(req.body?.billingKey || "").trim();
      if (!billingKey || !/^sk-/.test(billingKey)) {
        return res.status(400).json({ error: "billingKey is required (your sub2api key, sk-…) — every entry's turns bill against it" });
      }
      const notifyChannel = typeof req.body?.notifyChannel === "string" && req.body.notifyChannel.trim() ? req.body.notifyChannel.trim() : null;

      const results = [];
      const deployedSlugs = [];
      for (const e of c.entries) {
        const sc = e.suggestedConfig ?? {};
        const out = await deployPackCore(who, e.packId, {
          billingKey,
          ...(notifyChannel ? { notifyChannel } : {}),
          ...(e.agentId ? { agents: [e.agentId] } : {}),
          // suggestedConfig is agent-scoped by construction (validateEntries)
          // — an agent-less entry deploys under declaration defaults.
          ...(e.agentId && (sc.model || sc.budgetMinutes || sc.rhythm)
            ? {
                ...(sc.model ? { models: { [e.agentId]: sc.model } } : {}),
                ...(sc.budgetMinutes ? { budgets: { [e.agentId]: sc.budgetMinutes } } : {}),
                ...(sc.rhythm ? { rhythms: { [e.agentId]: sc.rhythm } } : {}),
              }
            : {}),
        });
        if (out.status === 200) {
          for (const d of out.body.deployed ?? []) deployedSlugs.push(d.slug);
          results.push({ packId: e.packId, ...(e.agentId ? { agentId: e.agentId } : {}), verdict: "deployed", slugs: (out.body.deployed ?? []).map((d) => d.slug) });
        } else if (out.status === 400 && out.body?.code === "IN_SERVICE") {
          // A bundle commonly mixes in already-deployed packs — a re-deploy
          // of a live entry is a no-op-by-policy skip, not a refusal.
          results.push({ packId: e.packId, ...(e.agentId ? { agentId: e.agentId } : {}), verdict: "skipped-in-service" });
        } else {
          results.push({
            packId: e.packId,
            ...(e.agentId ? { agentId: e.agentId } : {}),
            verdict: out.status === 400 || out.status === 402 ? "refused" : "error",
            error: typeof out.body?.error === "string" ? out.body.error : JSON.stringify(out.body?.error ?? out.body ?? {}),
          });
        }
      }
      log(`selfservice: ${who.email} bundle-deployed ${c.id} — ${deployedSlugs.length} agent(s) live`);
      res.json({ results, deployedSlugs });
    });

    // ── Public share face (M4③b): public collections only, no credential ────
    app.get("/api/wanxing/v1/collections/:id", async (req, res) => {
      if (needChannel(res)) return;
      const c = store.collectionGet(req.params.id);
      if (!c || c.visibility !== "public") return res.status(404).json({ error: "collection not found" });
      // The share face resolves against the anonymous browse — the same view
      // any visitor gets; owner email never rides.
      const entries = await resolveEntries({ email: "", groups: [] }, c.entries);
      res.json({ collection: { id: c.id, name: c.name, description: c.description, entries, updatedAt: c.updatedAt } });
    });

    // Deployer earnings view (add-deployer-revenue-share D5): the ADR-0022
    // ledger read back for the verified deployer. Identity email → sub2api
    // userId → earnings rows + settled/pending totals; no sub2api account
    // means the deployer has never been on the billing plane (a serving
    // deployment requires one), which is honestly empty — while a billing
    // plane outage is an explicit 502, never a silent empty list.
    app.get("/api/wanxing/v1/console/my/earnings", async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity — my/earnings is for a verified deployer" });

      let userId = null;
      if (sub2api && !sub2api.degraded()) {
        let acct;
        try {
          acct = await sub2api.findUserByEmail(who.email);
        } catch (e) {
          return res.status(502).json({ error: `billing plane unreachable: ${e?.message || e}` });
        }
        userId = acct?.userId ?? null;
      } else {
        return res.status(502).json({ error: "billing plane not configured on this deployment" });
      }
      if (userId == null) {
        return res.json({ rows: [], totals: { settledUsd: 0, pendingUsd: 0, turns: 0 } });
      }
      res.json({
        rows: store.earningsForDeployer(userId, 50),
        totals: store.earningsTotals(userId),
      });
    });
  }

  return { register, chatVerdict, channelReady };
}
