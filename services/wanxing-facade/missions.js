// ── Missions: M2 scenario-A task-definition face (add-mission-definitions) ──
//
// The four-tuple (goal / model / time window / cost cap) as a first-class
// row the planner agent consumes: an explicit state machine with ONE
// transition write point, dispatch over the existing agent lane (the facade
// calls the configured planner deployment upstream, exactly like the a2a
// face forwards a caller turn), an epoch writeback token for the planner's
// artifacts, a ledger-derived cost cap gating dispatch (402, never
// interrupting a running turn), and lifecycle events on the fleet channel.
//
// Settlement boundary (design D4): dispatch turns are recorded settler
// 'mission' and settle locally — the planner deployment's billing key
// already paid the model call upstream; this row is cap accounting and
// audit, not a second money movement.

import express from "express";
import { randomBytes } from "node:crypto";

// ── The state machine (design D2) ────────────────────────────────────────────
// One data table + one applicative transition. Roles: owner (the mission's
// console identity), ops (the service credential), planner (the epoch-token
// writeback lane), system (dispatch outcomes). Every write path — console
// routes, writeback, dispatch — goes through applyTransition; the store's
// optimistic-concurrency UPDATE is the single state-write point.

export const MISSION_TERMINAL = new Set(["reported", "failed", "aborted"]);

const RULES = [
  { from: "draft", to: "submitted", roles: ["owner", "ops"] },
  // Dispatch acceptance (design D2): the system moves a submitted mission to
  // planning as it fires the planner turn — the move carries the epoch token.
  { from: "submitted", to: "planning", roles: ["system"] },
  // The human gate: planner's plan lands awaiting approval; owner/ops approve.
  { from: "planning", to: "awaiting_approval", roles: ["planner"] },
  // The auto gate: plan lands pre-approved; planner's ready fires scheduling.
  { from: "planning", to: "auto_approved", roles: ["planner"] },
  { from: "awaiting_approval", to: "scheduled", roles: ["owner", "ops"] },
  { from: "auto_approved", to: "scheduled", roles: ["planner"] },
  { from: "scheduled", to: "executing", roles: ["planner"] },
  { from: "executing", to: "reported", roles: ["planner"] },
  // The planner may give up from any live post-dispatch state; the system
  // fails a mission whose dispatch could not be delivered — including before
  // the planning move landed (unresolvable planner deployment).
  ...["submitted", "planning", "awaiting_approval", "auto_approved", "scheduled", "executing"]
    .map((from) => ({ from, to: "failed", roles: ["planner", "system"] })),
  // Abort: owner or ops, from any non-terminal state.
  ...["draft", "submitted", "planning", "awaiting_approval", "auto_approved", "scheduled", "executing"]
    .map((from) => ({ from, to: "aborted", roles: ["owner", "ops"] })),
];

export function createMissionsFace({
  store,
  core,
  resolveDeployment, // async (slug) → { agentPath, packId?, agentId? } | null
  forwardHeaders,
  config, // { agentUrlFor(agentPath), writebackUrlFor(missionId) }
  report = null, // ({kind, agent, payload}) → fleet observer
  env = process.env,
  upstreamFetch = fetch,
  log = () => {},
}) {
  const plannerSlug = () => String(env.MISSION_PLANNER_SLUG || "").trim();

  const noteEvent = (mission, to, by) => {
    try {
      report?.({
        kind: `mission.${to}`,
        agent: plannerSlug() || "planner",
        payload: { mission: mission.id, owner: mission.ownerEmail, status: to, by: String(by || "") },
      });
    } catch { /* observability never blocks a transition */ }
  };

  // The one transition applier: rule lookup → optimistic store write →
  // event. A lost race or missing rule is the same thing — an illegal
  // transition that changes nothing.
  function applyTransition(mission, to, role, by, noteStr = "", extra = {}) {
    const rule = RULES.find((r) => r.from === mission.status && r.to === to && r.roles.includes(role));
    if (!rule) {
      return { ok: false, code: "ILLEGAL_TRANSITION", message: `mission ${mission.id}: ${mission.status} → ${to} is not a ${role} transition` };
    }
    const next = store.missionTransition(mission.id, mission.status, to, by, noteStr, extra);
    if (!next) {
      return { ok: false, code: "ILLEGAL_TRANSITION", message: `mission ${mission.id}: concurrent state change — ${mission.status} → ${to} lost the race` };
    }
    noteEvent(next, to, by);
    return { ok: true, mission: next };
  }

  // ── Four-tuple validation (spec: invalid input never lands a row) ─────────
  function validateInput({ goal, model, windowStart, windowEnd, costCapMinutes, approval }) {
    const errors = [];
    if (typeof goal !== "string" || !goal.trim() || goal.length > 4000) errors.push("goal must be a non-empty string of at most 4000 chars");
    if (model !== undefined && model !== null && (typeof model !== "string" || model.length > 200)) errors.push("model must be a string of at most 200 chars");
    const ws = Number(windowStart), we = Number(windowEnd);
    if (!Number.isInteger(ws) || !Number.isInteger(we) || we <= ws) errors.push("window must be integer epoch ms with end after start");
    const cap = Number(costCapMinutes);
    if (!Number.isInteger(cap) || cap < 1 || cap > 1_000_000) errors.push("costCapMinutes must be an integer in [1, 1000000]");
    if (approval !== undefined && approval !== null && approval !== "human" && approval !== "auto") errors.push("approval must be human or auto");
    return { errors, values: { goal: String(goal).trim(), model: String(model || ""), windowStart: ws, windowEnd: we, costCapMinutes: cap, approval: approval === "auto" ? "auto" : "human" } };
  }

  // ── Dispatch (design D3): the facade's service turn to the planner ────────
  // Pre-flight refusals are SYNCHRONOUS at submit (the draft survives):
  // missing planner config, an expired window, an exhausted cap. The upstream
  // call itself is fire-and-forget — its failure lands as planning→failed.

  function preflight(mission) {
    if (!plannerSlug()) {
      return { ok: false, status: 503, code: "MISSING_PLANNER", message: "no planner agent is configured (MISSION_PLANNER_SLUG) — the mission stays a draft" };
    }
    if (Date.now() > mission.windowEnd) {
      return { ok: false, status: 409, code: "MISSION_WINDOW_EXPIRED", message: "the mission's time window has ended — dispatch refused" };
    }
    if (store.missionSpent(mission.id) >= mission.costCapMinutes) {
      return { ok: false, status: 402, code: "MISSION_EXHAUSTED", message: "the mission's cost cap is exhausted — dispatch refused" };
    }
    return { ok: true };
  }

  function briefFor(mission, token) {
    return [
      "MISSION " + mission.id,
      "goal: " + mission.goal,
      "model: " + (mission.model || "(planner default)"),
      "window: " + new Date(mission.windowStart).toISOString() + " ~ " + new Date(mission.windowEnd).toISOString(),
      "cost cap: " + mission.costCapMinutes + " facade minutes",
      "approval: " + mission.approval,
      "",
      "writeback: POST " + config.writebackUrlFor(mission.id),
      "header: X-Mission-Token: " + token,
      'body: {"kind":"plan|ready|step|report|fail","payload":{…},"idempotencyKey":"<unique-per-write>"}',
      "plan payload: {steps:[{id,prompt,agent?,when?}]} (≤50 steps); ready: {}; step: {stepId,status,note?}; report: {summary,artifacts?}; fail: {reason}",
    ].join("\n");
  }

  async function dispatchMission(mission) {
    const slug = plannerSlug();
    let dep = null;
    try {
      dep = await resolveDeployment(slug);
    } catch { /* treated as unresolved below */ }
    if (!dep) {
      applyTransition(mission, "failed", "system", "system", `planner deployment not found: ${slug}`);
      return;
    }
    // Epoch token: minted per dispatch, superseded by the next one, dead on
    // any terminal state (the writeback route also refuses terminal).
    const token = `mt_${randomBytes(24).toString("hex")}`;
    const moved = applyTransition(mission, "planning", "system", "system", `dispatch to ${slug}`, { dispatchToken: token, dispatchTokenAt: Date.now() });
    if (!moved.ok) return; // raced (abort won) — nothing to dispatch

    const rpcBody = JSON.stringify({
      jsonrpc: "2.0",
      id: `mission-${mission.id}`,
      method: "message/send",
      params: { message: { role: "user", parts: [{ kind: "text", text: briefFor(moved.mission, token) }], context_id: `mission:${mission.id}` } },
    });
    const startedAt = Date.now();
    const attempt = () => upstreamFetch(config.agentUrlFor(dep.agentPath), {
      method: "POST",
      headers: { ...forwardHeaders(), "Content-Type": "application/json" },
      body: rpcBody,
    });
    // One bounded retry (design D3): a transient upstream refusal must not
    // kill the mission; a second failure is a real dispatch failure.
    let ok = false, lastErr = "";
    for (let i = 0; i < 2 && !ok; i++) {
      try {
        const r = await attempt();
        if (r.ok) ok = true;
        else lastErr = `upstream ${r.status}`;
      } catch (e) {
        lastErr = String(e?.message || e);
      }
    }
    core.recordUsage({
      caller: { userId: mission.ownerId, email: mission.ownerEmail },
      slug,
      idemKey: `dispatch-${mission.id}-${moved.mission.dispatchTokenAt}`,
      startedAt,
      endedAt: Date.now(),
      outcome: ok ? "ok" : "error",
      settler: "mission",
      missionId: mission.id,
    });
    if (!ok) {
      applyTransition(moved.mission, "failed", "system", "system", `dispatch failed (${lastErr})`);
      log(`missions: ${mission.id} dispatch failed: ${lastErr}`);
    }
  }

  // ── Writeback processing (spec: token-gated, idempotent, machine-bound) ──

  function processWriteback(mission, kind, payload) {
    const P = payload && typeof payload === "object" ? payload : {};
    if (kind === "plan") {
      const steps = P.steps;
      if (!Array.isArray(steps) || steps.length === 0 || steps.length > 50) {
        return { ok: false, status: 400, code: "BAD_PLAN", message: "plan payload needs steps: a non-empty array of at most 50" };
      }
      for (const s of steps) {
        if (!s || typeof s.id !== "string" || !s.id.trim() || typeof s.prompt !== "string" || !s.prompt.trim()) {
          return { ok: false, status: 400, code: "BAD_PLAN", message: "every step needs a string id and prompt" };
        }
      }
      const to = mission.approval === "auto" ? "auto_approved" : "awaiting_approval";
      const plan = { steps: steps.map((s) => ({ id: s.id, prompt: s.prompt, agent: s.agent ?? null, when: s.when ?? null, status: "pending" })) };
      const t = applyTransition(mission, to, "planner", "planner", `plan: ${plan.steps.length} steps`, { planJson: JSON.stringify(plan) });
      return t.ok ? { ok: true, status: t.mission.status } : { ok: false, status: 409, code: t.code, message: t.message };
    }
    if (kind === "ready") {
      const t = applyTransition(mission, "scheduled", "planner", "planner", P.note ? String(P.note).slice(0, 200) : "ready");
      return t.ok ? { ok: true, status: t.mission.status } : { ok: false, status: 409, code: t.code, message: t.message };
    }
    if (kind === "step") {
      // Step progress lives inside plan_json (design D2) — with one state
      // move folded in: the FIRST running step is the "首步开跑" signal that
      // carries scheduled→executing.
      if (!mission.plan || !Array.isArray(mission.plan.steps)) {
        return { ok: false, status: 409, code: "NO_PLAN", message: "no plan to report steps against" };
      }
      const stepId = String(P.stepId || "");
      const target = mission.plan.steps.find((s) => s.id === stepId);
      if (!target) return { ok: false, status: 400, code: "BAD_STEP", message: `unknown step id: ${stepId}` };
      target.status = String(P.status || "running").slice(0, 40);
      if (P.note) target.note = String(P.note).slice(0, 300);
      store.missionPatchArtifacts(mission.id, { plan: mission.plan });
      if (mission.status === "scheduled" && target.status === "running") {
        const t = applyTransition(mission, "executing", "planner", "planner", `step ${stepId} started`);
        if (t.ok) return { ok: true, status: t.mission.status };
        // A lost race here (abort won) is the illegal move, surfaced as-is.
        return { ok: false, status: 409, code: t.code, message: t.message };
      }
      return { ok: true, status: mission.status };
    }
    if (kind === "report") {
      if (typeof P.summary !== "string" || !P.summary.trim()) {
        return { ok: false, status: 400, code: "BAD_REPORT", message: "report payload needs a summary string" };
      }
      const report = { summary: P.summary.slice(0, 20000), artifacts: Array.isArray(P.artifacts) ? P.artifacts.slice(0, 50) : [], reportedAt: Date.now() };
      const t = applyTransition(mission, "reported", "planner", "planner", "report", { reportJson: JSON.stringify(report) });
      return t.ok ? { ok: true, status: t.mission.status } : { ok: false, status: 409, code: t.code, message: t.message };
    }
    if (kind === "fail") {
      const t = applyTransition(mission, "failed", "planner", "planner", String(P.reason || "planner gave up").slice(0, 300));
      return t.ok ? { ok: true, status: t.mission.status } : { ok: false, status: 409, code: t.code, message: t.message };
    }
    return { ok: false, status: 400, code: "BAD_KIND", message: "kind must be plan|ready|step|report|fail" };
  }

  // ── Route registration ─────────────────────────────────────────────────────
  // The writeback lane is planner-facing (epoch token, no console session);
  // the console lane resolves the owner from the verified identity's sub2api
  // account (the my/statement discipline: identity email → account, and the
  // ops token carries no identity so it reads the ops views only).

  function register(app, { requireToken, logtoAuth, sub2api }) {
    // Owner resolution for console routes: verified identity email → sub2api
    // account. Missions belong to accounts; an identity without one can view
    // nothing (empty list) rather than being refused — they simply cannot
    // own anything yet.
    const resolveOwner = async (req, res) => {
      const email = String(req.consoleIdentity?.email || "").toLowerCase();
      if (!email) return { ops: true, email: "", userId: null };
      if (!sub2api || sub2api.degraded()) {
        res.status(503).json({ error: "billing plane not configured — mission ownership is inactive" });
        return null;
      }
      let account = null;
      try {
        account = await sub2api.findUserByEmail(email);
      } catch { /* unresolvable identity reads as missionless */ }
      return { ops: false, email, userId: account?.userId ?? null };
    };

    app.get("/api/wanxing/v1/console/missions", async (req, res) => {
      if (!(await gateConsole(req, res, { requireToken, logtoAuth }))) return;
      const who = await resolveOwner(req, res);
      if (!who) return;
      const missions = who.ops ? store.missionList({}) : (who.userId ? store.missionList({ ownerId: who.userId }) : []);
      res.json({
        plannerConfigured: Boolean(plannerSlug()),
        missions: missions.map((m) => ({
          id: m.id, goal: m.goal.slice(0, 120), model: m.model, status: m.status, approval: m.approval,
          windowStart: m.windowStart, windowEnd: m.windowEnd, costCapMinutes: m.costCapMinutes,
          spentMinutes: store.missionSpent(m.id), ownerEmail: who.ops ? m.ownerEmail : undefined,
          createdAt: m.createdAt, updatedAt: m.updatedAt,
        })),
      });
    });

    app.get("/api/wanxing/v1/console/missions/:id", async (req, res) => {
      if (!(await gateConsole(req, res, { requireToken, logtoAuth }))) return;
      const m = store.missionGet(req.params.id);
      if (!m) return res.status(404).json({ error: "mission not found" });
      const who = await resolveOwner(req, res);
      if (!who) return;
      if (!who.ops && m.ownerId !== who.userId) return res.status(404).json({ error: "mission not found" });
      res.json({ mission: { ...m, dispatchToken: undefined, spentMinutes: store.missionSpent(m.id) } });
    });

    app.post("/api/wanxing/v1/console/missions", express.json({ limit: "8kb" }), async (req, res) => {
      if (!(await gateConsole(req, res, { requireToken, logtoAuth }))) return;
      const who = await resolveOwner(req, res);
      if (!who) return;
      if (who.ops || !who.userId) {
        return res.status(403).json({ error: "missions are created by a verified identity with a billing account (the ops token carries no identity)" });
      }
      const v = validateInput(req.body ?? {});
      if (v.errors.length) return res.status(400).json({ error: v.errors.join("; ") });
      const mission = store.missionCreate({ ownerId: who.userId, ownerEmail: who.email, ...v.values });
      log(`missions: ${mission.id} created by ${who.email} (cap ${v.values.costCapMinutes}m)`);
      res.status(201).json({ mission: { ...mission, dispatchToken: undefined } });
    });

    // submit: synchronous pre-flight refusals keep the draft; the dispatch
    // itself fires after the state move, out of the request's critical path.
    app.post("/api/wanxing/v1/console/missions/:id/submit", async (req, res) => {
      if (!(await gateConsole(req, res, { requireToken, logtoAuth }))) return;
      const who = await resolveOwner(req, res);
      if (!who) return;
      const m = store.missionGet(req.params.id);
      if (!m) return res.status(404).json({ error: "mission not found" });
      if (!who.ops && m.ownerId !== who.userId) return res.status(404).json({ error: "mission not found" });
      const role = who.ops ? "ops" : "owner";
      const pre = preflight(m);
      if (!pre.ok) return res.status(pre.status).json({ error: { code: pre.code, message: pre.message } });
      const t = applyTransition(m, "submitted", role, who.ops ? "ops" : who.email);
      if (!t.ok) return res.status(409).json({ error: { code: t.code, message: t.message } });
      void dispatchMission(t.mission);
      res.json({ ok: true, status: "submitted" });
    });

    const action = (to, role) => async (req, res) => {
      if (!(await gateConsole(req, res, { requireToken, logtoAuth }))) return;
      const who = await resolveOwner(req, res);
      if (!who) return;
      const m = store.missionGet(req.params.id);
      if (!m) return res.status(404).json({ error: "mission not found" });
      if (!who.ops && m.ownerId !== who.userId) return res.status(404).json({ error: "mission not found" });
      const t = applyTransition(m, to, who.ops ? "ops" : role, who.ops ? "ops" : who.email);
      if (!t.ok) return res.status(409).json({ error: { code: t.code, message: t.message } });
      res.json({ ok: true, status: t.mission.status });
    };
    app.post("/api/wanxing/v1/console/missions/:id/approve", action("scheduled", "owner"));
    app.post("/api/wanxing/v1/console/missions/:id/abort", action("aborted", "owner"));

    // ── The planner's writeback lane (epoch token; no console session) ──────
    app.post("/api/wanxing/v1/missions/:id/writeback", express.json({ limit: "64kb" }), async (req, res) => {
      const m = store.missionGet(req.params.id);
      if (!m) return res.status(404).json({ error: { code: "MISSION_NOT_FOUND", message: "no such mission" } });
      const kind = String(req.body?.kind || "");
      const idemKey = String(req.body?.idempotencyKey || "").trim();
      if (!idemKey) return res.status(400).json({ error: { code: "IDEM_KEY_REQUIRED", message: "every writeback carries an idempotencyKey" } });
      // Replay short-circuit FIRST (spec: same key ⇒ same result): a recorded
      // writeback returns its result even after the epoch died — the write
      // already happened, replaying it can never mutate anything again.
      const prior = store.missionWritebackGet(m.id, idemKey);
      if (prior) {
        const r = prior.result;
        if (r?.ok) return res.json(r);
        return res.status(Number.isInteger(r?.status) ? r.status : 409).json(r);
      }
      // New writes need a live epoch token: present, current, and the mission
      // not yet terminal (a terminal mission's token is dead by design).
      const token = String(req.headers["x-mission-token"] || "");
      if (!token || token !== m.dispatchToken || MISSION_TERMINAL.has(m.status)) {
        return res.status(401).json({ error: { code: "WRITEBACK_TOKEN_INVALID", message: "the writeback token is absent, superseded, or the mission is terminal" } });
      }

      const out = processWriteback(m, kind, req.body?.payload);
      store.missionWritebackRecord(m.id, idemKey, kind,
        out.ok ? { ok: true, status: out.status } : { ok: false, status: out.status, error: { code: out.code, message: out.message } });
      if (out.ok) return res.json({ ok: true, status: out.status });
      return res.status(out.status).json({ error: { code: out.code, message: out.message } });
    });
  }

  return { register, applyTransition, dispatchMission, preflight, validateInput, processWriteback };
}

// The console missions gate mirrors console.js's dual gate (service token or
// verified Logto identity) — kept local so this module wires standalone in
// tests exactly like production.
async function gateConsole(req, res, { requireToken, logtoAuth }) {
  if (requireToken(req)) return true;
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const ident = logtoAuth ? await logtoAuth.verifyIdToken(token).catch(() => null) : null;
  if (ident) {
    req.consoleIdentity = ident;
    return true;
  }
  res.status(401).json({ error: "console credential or verified identity required" });
  return false;
}
