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
  logtoAuth,
  requireToken,
  env = process.env,
  fetchImpl = fetch,
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
            const d = await r.json();
            agents = (d?.manifest?.agents ?? [])
              .filter((a) => a?.serving)
              .map((a) => ({ id: a.id, name: a.name }));
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

    app.post("/api/wanxing/v1/console/my/packs/:id/deploy", express.json({ limit: "4kb" }), async (req, res) => {
      const who = await gate(req, res);
      if (!who) return;
      if (who.ops) return res.status(403).json({ error: "the ops token carries no identity — deploy is for a verified deployer" });
      if (needChannel(res)) return;

      const billingKey = String(req.body?.billingKey || "").trim();
      if (!billingKey || !/^sk-/.test(billingKey)) {
        return res.status(400).json({ error: "billingKey is required (your sub2api key, sk-…) — the deployment's turns bill against it" });
      }
      const notifyChannel = typeof req.body?.notifyChannel === "string" && req.body.notifyChannel.trim() ? req.body.notifyChannel.trim() : null;

      // Ownership: the facet detail is the truth (browse rows can lag).
      let detail;
      try {
        const r = await facetCall(who.identity, `/api/packs/${encodeURIComponent(req.params.id)}`);
        if (r.status === 404) return res.status(404).json({ error: "pack not found" });
        if (!r.ok) throw Object.assign(new Error(`facet detail ${r.status}`), { status: 502 });
        detail = await r.json();
      } catch (e) {
        return res.status(Number.isInteger(e?.status) ? e.status : 502).json({ error: `packs surface unreachable: ${e?.message || e}` });
      }
      if (String(detail?.authorEmail || "").toLowerCase() !== who.email) {
        return res.status(404).json({ error: "pack not found" }); // foreign packs do not exist on this face
      }
      const serving = (detail?.manifest?.agents ?? []).filter((a) => a?.serving);
      if (serving.length === 0) {
        return res.status(400).json({ error: "no serving-contract agent in this pack — 只有带 serving 契约的 agent 可部署为服务" });
      }
      const version = Number.isInteger(req.body?.version) && req.body.version > 0 ? req.body.version : (detail.version ?? null);
      if (!version) return res.status(400).json({ error: "version could not be resolved" });

      // One key backs every serving agent (v1): the deployer's own account.
      const body = {
        billingKeys: Object.fromEntries(serving.map((a) => [a.id, billingKey])),
        ...(notifyChannel ? { notifyChannel: Object.fromEntries(serving.map((a) => [a.id, notifyChannel])) } : {}),
      };
      try {
        const r = await facetCall(who.identity, `/api/packs/${encodeURIComponent(req.params.id)}/versions/${version}/deploy`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        const doc = await r.json().catch(() => ({}));
        if (!r.ok) {
          // Facet's structured refusal passes through verbatim (balance gate,
          // model lane validation, …) — the deployer sees the real reason.
          return res.status(r.status).json(doc ?? { error: `facet deploy ${r.status}` });
        }
        log(`selfservice: ${who.email} deployed ${req.params.id} v${version} (${serving.map((a) => a.id).join(",")})`);
        res.json({
          deployed: (doc?.deployed ?? []).map((d) => ({
            agentId: d.agentId,
            agentPath: d.agentPath,
            slug: slugFor(d.agentPath),
          })),
          version,
        });
      } catch (e) {
        res.status(502).json({ error: `deploy forward failed: ${e?.message || e}` });
      }
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
  }

  return { register, chatVerdict, channelReady };
}
