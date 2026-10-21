// ── Wanxing facade, the cluster unit face (add-cluster-service-unit) ────────
//
// A pack that DECLARES a cluster and has a served default member is served
// as ONE A2A unit: its own route family (/a2a/cluster/:slug — disjoint from
// the per-agent routes by path shape), a public list, a card, and a
// message/send that fans out to the unit's served members and aggregates by
// policy. The composition lives HERE, in the facade (D1): members are
// already independent served deployments, so a composite is several forwards
// plus an aggregation — no runner change, borrowed contracts untouched.
//
// Truth is derived, never persisted: the cluster index (a2a face) × the
// deployment snapshot. Every member turn books through the SAME kernel a
// direct turn does (runMemberTurn → finishTurn): its own slot, usage row
// (cluster_turn_id linkage), settlement, deployer share, callback, fleet
// event. The unit itself records no row and bills nothing.

import express from "express";
import { randomBytes } from "node:crypto";
import { slugFor } from "./core.js";
import { contextIdFor } from "./a2a.js";

const textOf = (message) => {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  return text || null;
};

const jsonRpcError = (id, code, message, data = undefined) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  ...(data !== undefined ? { error: { code, message, data } } : { error: { code, message } }),
});

export const AGGREGATIONS = ["all", "first", "summary"];

export function createClusterFace({
  core,
  a2a,               // { agentState, entryFor, clusterMap, runMemberTurn } from createA2aFace
  listDeployments,   // async () → [{ slug, agentPath, packId, agentId }]
  hardStale = () => false,
  ensureFresh = async () => {},
  report = null,
  env = process.env,
  log = () => {},
}) {
  const memberTimeoutMs = () => {
    const v = Number(env.WANXING_CLUSTER_MEMBER_TIMEOUT_MS);
    return Number.isFinite(v) && v > 0 ? v : 300_000;
  };
  const note = (kind, agent, payload = {}, id = null) => {
    try {
      report?.({ kind, agent, payload, id });
    } catch { /* observability never breaks a turn */ }
  };
  const sourceUnavailable = (res, why) =>
    res.status(503).json({ error: { code: "DEPLOYMENT_SOURCE_UNAVAILABLE", message: `deployment source unreachable (${why})` } });

  // ── Unit resolution ────────────────────────────────────────────────────────
  // The cluster index joined against the deployment snapshot: a member is
  // served when its (packId, agentId) has a deployment row. Listed when at
  // least one DEFAULT member is served (a partial team is a unit, honestly
  // labelled); entry visibility is read through the a2a face's entry cache
  // so private served members can be hidden from public faces while staying
  // callable by allowlisted callers at turn time.
  const unitOf = (cluster, deployments) => {
    const byAgentId = new Map(deployments.filter((d) => d.packId === cluster.id).map((d) => [String(d.agentId), d]));
    const members = [
      ...cluster.defaultAgents.map((id) => ({ id, role: "default" })),
      ...cluster.optionalAgents.map((id) => ({ id, role: "optional" })),
    ].map(({ id, role }) => {
      const d = byAgentId.get(id) ?? null;
      return { id, name: cluster.agentNames[id] ?? id, role, served: Boolean(d), slug: d?.slug ?? null };
    });
    const servedDefaults = members.some((m) => m.role === "default" && m.served);
    return servedDefaults
      ? {
          id: cluster.id,
          slug: slugFor(cluster.id),
          name: cluster.name,
          description: cluster.description,
          policy: cluster.policy ?? {},
          members,
        }
      : null;
  };

  async function units() {
    const [clusters, deployments] = await Promise.all([a2a.clusterMap(), listDeployments()]);
    return [...clusters.values()].map((c) => unitOf(c, deployments)).filter(Boolean);
  }

  // Public member projection: a private SERVED member is hidden (its slug
  // would leak); an unserved member has no entry to read and stays listed as
  // served:false (the declaration is public pack content anyway).
  async function publicMembers(unit) {
    const out = [];
    for (const m of unit.members) {
      if (m.served) {
        const entry = await a2a.entryFor(m.slug).catch(() => null);
        if (entry?.visibility === "private") continue;
      }
      const { role, ...rest } = m;
      out.push({ ...rest, role });
    }
    return out;
  }

  function register(app) {
    // ── Public list ──────────────────────────────────────────────────────────
    app.get("/api/wanxing/v1/clusters", async (req, res) => {
      await ensureFresh().catch(() => {});
      if (hardStale()) return sourceUnavailable(res, "snapshot hard-stale");
      let list;
      try {
        list = await units();
      } catch (e) {
        return sourceUnavailable(res, String(e?.message || e));
      }
      const out = [];
      for (const u of list) {
        const members = await publicMembers(u);
        if (!members.some((m) => m.served)) continue; // all served members private: no public unit
        out.push({
          slug: u.slug,
          id: u.id,
          name: u.name,
          description: u.description,
          policy: u.policy,
          members: members.map(({ id, name, role, served, slug }) => ({ id, name, role, served, ...(slug ? { slug } : {}) })),
          url: `${req.protocol}://${req.get("host")}/api/wanxing/v1/a2a/cluster/${u.slug}`,
        });
      }
      res.json({ clusters: out });
    });

    // ── Unit card ────────────────────────────────────────────────────────────
    app.get("/api/wanxing/v1/a2a/cluster/:clusterSlug/.well-known/agent-card.json", async (req, res) => {
      await ensureFresh().catch(() => {});
      if (hardStale()) return sourceUnavailable(res, "snapshot hard-stale");
      let unit;
      try {
        unit = (await units()).find((u) => u.slug === String(req.params.clusterSlug).toLowerCase()) ?? null;
      } catch (e) {
        return sourceUnavailable(res, String(e?.message || e));
      }
      if (!unit) return res.status(404).json({ error: { code: "CLUSTER_NOT_FOUND", message: "no served cluster at this route (a default member must be deployed)" } });
      const members = await publicMembers(unit);
      if (!members.some((m) => m.served)) {
        return res.status(404).json({ error: { code: "CLUSTER_NOT_FOUND", message: "no public served member on this cluster" } });
      }
      res.json({
        name: unit.name,
        description: unit.description,
        provider: { organization: "paas-pack" },
        capabilities: { streaming: false },
        skills: members
          .filter((m) => m.served)
          .map((m) => ({ id: m.id, name: m.name, description: `集群成员（${m.role === "default" ? "默认" : "可选"}）`, tags: [m.role] })),
        tags: ["cluster"],
        default_input_modes: ["text"],
        default_output_modes: ["text"],
        preferred_transport: "jsonrpc",
        url: `${req.protocol}://${req.get("host")}/api/wanxing/v1/a2a/cluster/${unit.slug}`,
        cluster: {
          id: unit.id,
          policy: unit.policy,
          aggregations: AGGREGATIONS,
          members: members.map(({ id, name, role, served, slug }) => ({ id, name, role, served, ...(slug ? { slug } : {}) })),
        },
      });
    });

    // ── The cluster turn ─────────────────────────────────────────────────────
    app.post("/api/wanxing/v1/a2a/cluster/:clusterSlug", express.json({ limit: "1mb" }), async (req, res) => {
      const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const auth = await core.authenticate(bearer);
      if (!auth.ok) {
        note("refused", req.params.clusterSlug, { stage: "key", code: auth.code });
        return res.status(auth.status).json({ error: { code: auth.code, message: auth.message } });
      }
      const caller = auth.caller;

      const { id, method, params } = req.body ?? {};
      if (req.body?.jsonrpc !== "2.0" || typeof method !== "string") {
        return res.status(200).json(jsonRpcError(id, -32600, "Invalid Request"));
      }
      if (method !== "message/send") {
        return res.status(200).json(jsonRpcError(id, -32601, "cluster units accept message/send only"));
      }
      const message = params?.message ?? params;
      const text = textOf(message);
      if (!text) return res.status(200).json(jsonRpcError(id, -32604, "empty message"));

      await ensureFresh().catch(() => {});
      let unit;
      try {
        unit = (await units()).find((u) => u.slug === String(req.params.clusterSlug).toLowerCase()) ?? null;
      } catch (e) {
        note("refused", req.params.clusterSlug, { stage: "source", code: "DEPLOYMENT_SOURCE_UNAVAILABLE" });
        return sourceUnavailable(res, String(e?.message || e));
      }
      if (!unit) {
        return res.status(404).json({ error: { code: "CLUSTER_NOT_FOUND", message: "no served cluster at this route (a default member must be deployed)" } });
      }
      const unitSlug = unit.slug;

      // Plan gate and RPM: ONCE per composite (the caller made one request).
      const planGate = core.checkPlan(caller);
      if (!planGate.ok) {
        note("refused", unitSlug, { stage: "plan", code: planGate.code, caller: caller.email || caller.userId });
        return res.status(planGate.status).json({ error: { code: planGate.code, message: planGate.message } });
      }
      if (!core.checkRpm(caller.userId)) {
        note("refused", unitSlug, { stage: "rate", code: "RATE_LIMITED", caller: caller.email || caller.userId });
        return res.status(429).json({ error: { code: "RATE_LIMITED", message: "caller rate limit exceeded" } });
      }

      const idemKey = (() => {
        const h = req.headers["idempotency-key"];
        return typeof h === "string" && h.trim() ? h.trim().slice(0, 200) : null;
      })();
      const prior = core.idempotencyState({ callerId: caller.userId, slug: unitSlug, idemKey });
      let holdsSlot = false;
      if (prior === "new") {
        if (!core.acquireSlot(caller.userId, unitSlug)) {
          note("refused", unitSlug, { stage: "slot", code: "TURN_IN_FLIGHT", caller: caller.email || caller.userId });
          res.set("Retry-After", "5");
          return res.status(409).json({ error: { code: "TURN_IN_FLIGHT", message: "a cluster turn for this caller is already running; retry after the hint" } });
        }
        holdsSlot = true;
      }

      // Member selection: the served defaults, or an explicit subset.
      const requested = message?.metadata?.agents;
      let selected = unit.members.filter((m) => m.served && m.role === "default");
      if (requested !== undefined) {
        if (!Array.isArray(requested) || requested.length === 0 || !requested.every((v) => typeof v === "string")) {
          if (holdsSlot) core.releaseSlot(caller.userId, unitSlug);
          return res.status(200).json(jsonRpcError(id, -32602, "metadata.agents must be a non-empty array of member ids"));
        }
        const bad = requested.filter((rid) => !unit.members.some((m) => m.id === rid));
        if (bad.length) {
          if (holdsSlot) core.releaseSlot(caller.userId, unitSlug);
          return res.status(200).json(jsonRpcError(id, -32602, `unknown cluster member(s): ${bad.join(", ")}`));
        }
        const unserved = requested.filter((rid) => !unit.members.find((m) => m.id === rid).served);
        if (unserved.length) {
          if (holdsSlot) core.releaseSlot(caller.userId, unitSlug);
          return res.status(200).json(jsonRpcError(id, -32602, `member(s) not served: ${unserved.join(", ")}`));
        }
        selected = unit.members.filter((m) => requested.includes(m.id));
      }

      // Per-member admission (each member is admitted by the agent rules);
      // desktop-seat members skip — an async mailbox answer cannot join a
      // synchronous composite.
      const admitted = [];
      const skipped = [];
      for (const m of selected) {
        let state = null;
        try {
          state = await a2a.agentState(m.slug);
        } catch { /* source hiccup: treat as not served right now */ }
        if (!state?.exists) {
          skipped.push({ id: m.id, name: m.name, slug: m.slug, status: "skipped", reason: "NOT_SERVED" });
          continue;
        }
        if (state.paused) {
          skipped.push({ id: m.id, name: m.name, slug: m.slug, status: "skipped", reason: "AGENT_PAUSED" });
          continue;
        }
        const verdict = core.admit(caller, state);
        if (!verdict.ok) {
          skipped.push({ id: m.id, name: m.name, slug: m.slug, status: "skipped", reason: verdict.code });
          continue;
        }
        admitted.push({ m, state });
      }
      if (!admitted.length) {
        if (holdsSlot) core.releaseSlot(caller.userId, unitSlug);
        note("refused", unitSlug, { stage: "admission", code: "CLUSTER_NOT_ADMITTED", caller: caller.email || caller.userId });
        return res.status(403).json({
          error: {
            code: "CLUSTER_NOT_ADMITTED",
            message: "no selected cluster member admitted this caller",
            members: skipped,
          },
        });
      }

      const aggregation = AGGREGATIONS.includes(message?.metadata?.aggregation) ? message.metadata.aggregation : "all";
      const cap = Number.isInteger(unit.policy?.maxConcurrentRuns) && unit.policy.maxConcurrentRuns > 0
        ? unit.policy.maxConcurrentRuns
        : admitted.length;
      const timeoutMs = memberTimeoutMs();
      // The unit context keeps the external prefix so the runner reaps it;
      // member contexts derive from it (and from the idempotency key when
      // the caller supplied none) so a caller's context_id continues every
      // member's conversation.
      const contextId = contextIdFor(message, idemKey, null);
      const clusterTurnId = `wc_${randomBytes(12).toString("hex")}`;
      const startedAt = Date.now();
      note("admitted", unitSlug, {
        caller: caller.email || caller.userId,
        idem_key: idemKey || "",
        cluster_id: unit.id,
        members: admitted.map((a) => a.m.id),
        skipped: skipped.map((s) => s.id),
        aggregation,
      });

      // One member flight: derived idempotency key (`<key>--<agentId>`) so a
      // replayed composite reuses finished members and reruns the rest.
      const runOne = async ({ m, state }) => {
        const r = await a2a.runMemberTurn({
          caller,
          slug: m.slug,
          state,
          text,
          contextId: `${contextId}--${m.id}`,
          idemKey: idemKey ? `${idemKey.slice(0, 180)}--${m.id}` : null,
          clusterTurnId,
          timeoutMs,
          rpcId: id,
        });
        return {
          id: m.id,
          name: m.name,
          slug: m.slug,
          role: m.role,
          status: r.status,
          ...(r.reason ? { reason: r.reason } : {}),
          ...(r.durationMs != null ? { durationMs: r.durationMs } : {}),
          ...(r.minutesBilled != null ? { minutesBilled: r.minutesBilled } : {}),
          ...(r.text ? { text: r.text } : {}),
          ...(r.replayed ? { replayed: true } : {}),
        };
      };

      try {
        const out = await core.idempotentSend({
          callerId: caller.userId,
          slug: unitSlug,
          idemKey,
          exec: async () => {
            // Worker-pool fan-out, bounded by the declaration's cap (absent
            // = every admitted member at once — members are independent
            // deployments, the parallelism is real).
            const results = new Array(admitted.length);
            let cursor = 0;
            let done = 0;
            const finishOrder = new Array(admitted.length);
            const worker = async () => {
              for (;;) {
                const i = cursor++;
                if (i >= admitted.length) return;
                results[i] = await runOne(admitted[i]);
                finishOrder[i] = done++;
              }
            };
            await Promise.all(Array.from({ length: Math.max(1, Math.min(cap, admitted.length)) }, worker));

            // Summary (opt-in): one more member turn on the first successful
            // DEFAULT member in declaration order (admitted preserves it);
            // a failed synthesis, or no successful default, falls back to
            // the plain aggregate with the fallback noted.
            let summaryBy = null;
            let fallbackNote = null;
            if (aggregation === "summary") {
              const leadIdx = results.findIndex((r) => r.status === "ok" && r.role === "default" && r.text);
              if (leadIdx >= 0) {
                const lead = admitted[leadIdx];
                const outputs = results
                  .filter((r) => r.status === "ok" && r.text)
                  .map((r) => `【${r.name}】\n${r.text}`)
                  .join("\n\n");
                const synthPrompt =
                  `以下是集群「${unit.name}」各成员对同一任务的输出。\n\n原始任务：${text}\n\n${outputs}\n\n` +
                  `请综合以上成员输出，给出一份统一的最终答复：先给结论，再列各成员的关键贡献，最后指出成员间的分歧或缺口（如有）。`;
                const synth = await a2a.runMemberTurn({
                  caller,
                  slug: lead.m.slug,
                  state: lead.state,
                  text: synthPrompt,
                  contextId: `${contextId}--summary`,
                  idemKey: idemKey ? `${idemKey.slice(0, 176)}--summary` : null,
                  clusterTurnId,
                  timeoutMs,
                  rpcId: id,
                });
                if (synth.status === "ok" && synth.text) {
                  summaryBy = lead.m.id;
                  results.push({
                    id: lead.m.id,
                    name: `${lead.m.name}（汇总）`,
                    slug: lead.m.slug,
                    role: lead.m.role,
                    status: "ok",
                    ...(synth.durationMs != null ? { durationMs: synth.durationMs } : {}),
                    ...(synth.minutesBilled != null ? { minutesBilled: synth.minutesBilled } : {}),
                    text: synth.text,
                    summary: true,
                  });
                } else {
                  fallbackNote = `汇总回合失败（${synth.error || synth.reason || "未知"}），以下为成员原始输出。`;
                }
              } else {
                fallbackNote = "无默认成员产出可牵头汇总，以下为成员原始输出。";
              }
            }

            const sections = results
              .filter((r) => r.status === "ok" && r.text && !r.summary)
              .map((r) => `## ${r.name}（${r.role === "default" ? "默认成员" : "可选成员"}）\n\n${r.text}`);
            const failed = [
              ...results
                .filter((r) => r.status !== "ok")
                .map((r) => `- ${r.name}：${r.status === "skipped" ? `跳过（${r.reason}）` : `失败（${r.reason ?? r.error ?? "error"}）`}`),
              ...skipped.map((s) => `- ${s.name}：跳过（${s.reason}）`),
            ];
            const synth = results.find((r) => r.summary && r.status === "ok");
            let finalText;
            if (aggregation === "first") {
              const byFinish = results.map((r, i) => ({ r, i })).filter(({ r }) => r.status === "ok" && r.text);
              const winner = byFinish.slice().sort((a, b) => finishOrder[a.i] - finishOrder[b.i])[0]?.r ?? null;
              finalText = winner?.text ?? "";
              if (!winner) finalText = "所有成员均未产出。";
            } else if (synth?.text) {
              finalText = synth.text;
            } else {
              finalText = sections.join("\n\n") || "所有成员均未产出。";
            }
            if (fallbackNote) finalText = `${finalText}\n\n（${fallbackNote}）`;
            if (aggregation !== "first" && failed.length && !synth?.text) {
              finalText = `${finalText}\n\n---\n未产出成员：\n${failed.join("\n")}`;
            }

            const block = {
              id: unit.id,
              slug: unitSlug,
              name: unit.name,
              aggregation,
              members: [
                ...skipped,
                ...results.map(({ text: _t, ...rest }) => rest),
              ],
              ...(summaryBy ? { summaryBy } : {}),
            };
            const anyOk = results.some((r) => r.status === "ok");
            const response = anyOk
              ? {
                  jsonrpc: "2.0",
                  id: id ?? null,
                  result: {
                    message: {
                      message_id: `m-${clusterTurnId}`,
                      context_id: contextId,
                      kind: "message",
                      parts: [{ kind: "text", text: finalText }],
                      metadata: { cluster: block },
                    },
                  },
                }
              : jsonRpcError(id, -32040, "all cluster members failed", { cluster: block });
            return { response };
          },
        });
        if (holdsSlot) core.releaseSlot(caller.userId, unitSlug);
        if (out.replayed) log(`cluster replay served from ledger (${unitSlug})`);
        note("cluster", unitSlug, {
          cluster_id: unit.id,
          aggregation,
          outcome: out.response?.error ? "error" : "ok",
          members: out.response?.result?.message?.metadata?.cluster?.members ?? out.response?.error?.data?.cluster?.members ?? [],
        }, clusterTurnId);
        res.status(200).json(out.response);
      } catch (e) {
        if (holdsSlot) core.releaseSlot(caller.userId, unitSlug);
        note("cluster", unitSlug, { cluster_id: unit.id, aggregation, outcome: "error", error: String(e?.message || e) }, clusterTurnId);
        res.status(200).json(jsonRpcError(id, Number.isInteger(e?.code) ? e.code : -32032, String(e?.message || e)));
      }
    });
  }

  return { register, units, unitOf };
}
