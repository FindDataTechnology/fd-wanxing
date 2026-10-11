#!/usr/bin/env node
// ── Mission-definition tests (add-mission-definitions tasks 1.1–6.1) ────────
//
// The four-tuple surface end to end: the missions store and ledger-derived
// spent, the transition table (legal paths, illegal moves, optimistic
// concurrency), dispatch pre-flight refusals and the upstream planner turn,
// the epoch writeback (token gate, idempotent replay, machine-bound kinds),
// the cost cap at the dispatch gate, the console owner/ops routes, and the
// fleet lifecycle events.
//
//   node --test scripts/test-wanxing-missions.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { test } from "node:test";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-missions-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore, } = await import("../services/wanxing-facade/core.js");
const { createMissionsFace, MISSION_TERMINAL } = await import("../services/wanxing-facade/missions.js");

const OPS_TOKEN = "ops-secret";
const OWNER_TOKEN = "owner-id-token";
const OWNER = { userId: 7, email: "owner@finddata.tech" };

function stubSub2api() {
  return {
    adjustCalls: [],
    degraded: () => false,
    async probeKeyLiveness() { return { ok: true }; },
    async findUserByKey() { return { userId: OWNER.userId, email: OWNER.email }; },
    async findUserByEmail(mail) { return mail === OWNER.email ? { userId: OWNER.userId, email: OWNER.email } : null; },
    async adjustBalance(args) { this.adjustCalls.push(args); return { ok: true }; },
  };
}

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

// Every harness server registers here so a failing assertion mid-test cannot
// leak a listener and hang the runner — after() closes whatever is left.
const openServers = [];
test.after(async () => { for (const s of openServers.splice(0)) await s.close().catch(() => {}); });

// The listening app: missions face wired like routes.js does, with a stub
// planner upstream capturing the brief, and a report spy for events.
function appHarness({ sub = stubSub2api(), store = freshStore(), plannerSlug = "packs-pl-planner", upstream = null } = {}) {
  const events = [];
  const upstreamCalls = [];
  const doUpstream = upstream ?? (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: { parts: [{ kind: "text", text: "ok" }] } } }), { headers: { "Content-Type": "application/json" } }));
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 100 } });
  const face = createMissionsFace({
    store,
    core,
    // The resolver always knows the ONE real planner slug; harness options
    // change only what the env points at (absent or ghost → unresolved).
    resolveDeployment: (slug) => (slug === "packs-pl-planner" ? { agentPath: "/packs/pl/planner", packId: "pl", agentId: "planner" } : null),
    forwardHeaders: () => ({}),
    config: {
      agentUrlFor: (p) => `https://registry.internal/agent${p}/`,
      writebackUrlFor: (id) => `https://wanxing.example/api/wanxing/v1/missions/${id}/writeback`,
    },
    report: (ev) => events.push(ev),
    env: { MISSION_PLANNER_SLUG: plannerSlug },
    upstreamFetch: async (url, init) => {
      upstreamCalls.push({ url, body: init?.body });
      return doUpstream(url, init);
    },
    log: () => {},
  });
  const app = express();
  face.register(app, {
    requireToken: (req) => String(req.headers.authorization || "") === `Bearer ${OPS_TOKEN}`,
    logtoAuth: {
      configured: true,
      verifyIdToken: async (token) => (token === OWNER_TOKEN ? { email: OWNER.email } : null),
    },
    sub2api: sub,
  });
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (p, opts = {}) => {
    const r = await fetch(base + p, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const owner = (p, opts = {}) => json(p, { ...opts, headers: { Authorization: `Bearer ${OWNER_TOKEN}`, ...(opts.headers ?? {}) } });
  const h = {
    core, store, sub, base, events, upstreamCalls, face,
    close: () => new Promise((r) => server.close(() => r())),
    json, owner,
    ops: (p, opts = {}) => json(p, { ...opts, headers: { Authorization: `Bearer ${OPS_TOKEN}`, ...(opts.headers ?? {}) } }),
    // Dispatch is fire-and-forget by design: wait for the planning move (and
    // its epoch token) to land before touching the writeback lane.
    waitFor: async (id, status, ms = 2000) => {
      const deadline = Date.now() + ms;
      for (;;) {
        const m = store.missionGet(id);
        if (m.status === status) return m;
        if (Date.now() > deadline) throw new Error(`mission ${id} never reached ${status} (at ${m.status})`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
  openServers.push(h);
  return h;
}

const fourTuple = (over = {}) => ({
  goal: "把 2026Q3 中国新能源车销量整理成一份带来源的简报",
  model: "deepseek-v4.1-flash",
  windowStart: Date.now() - 1000,
  windowEnd: Date.now() + 86_400_000,
  costCapMinutes: 30,
  approval: "human",
  ...over,
});

// A mission driven to a target state through the API, returning its row.
async function drive(h, { approval = "human", to = "planning" } = {}) {
  const created = await h.owner("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(fourTuple({ approval })) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.mission.id;
  const wb = (kind, payload, key, token) => h.json(`/api/wanxing/v1/missions/${id}/writeback`, {
    method: "POST",
    headers: { "X-Mission-Token": token },
    body: JSON.stringify({ kind, payload, idempotencyKey: key }),
  });
  if (to === "draft") return { id, token: null, wb };
  const sub = await h.owner(`/api/wanxing/v1/console/missions/${id}/submit`, { method: "POST" });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const m = await h.waitFor(id, "planning");
  const token = m.dispatchToken;
  if (to === "planning") return { id, token, wb };
  const plan = await wb("plan", { steps: [{ id: "s1", prompt: "collect data" }, { id: "s2", prompt: "write brief" }] }, "k-plan", token);
  assert.equal(plan.body.ok, true, JSON.stringify(plan.body));
  if (to === "awaiting_approval" || to === "auto_approved") return { id, token, wb };
  if (approval === "human") {
    const ap = await h.owner(`/api/wanxing/v1/console/missions/${id}/approve`, { method: "POST" });
    assert.equal(ap.status, 200);
  } else {
    const rd = await wb("ready", {}, "k-ready", token);
    assert.equal(rd.body.ok, true, JSON.stringify(rd.body));
  }
  if (to === "scheduled") return { id, token, wb };
  const ex = await wb("step", { stepId: "s1", status: "running" }, "k-step1", token);
  assert.equal(ex.body.ok, true, JSON.stringify(ex.body));
  if (to === "executing") return { id, token, wb };
  const rep = await wb("report", { summary: "简报完成，两步全绿" }, "k-report", token);
  assert.equal(rep.body.ok, true, JSON.stringify(rep.body));
  return { id, token, wb };
}

// ── 1.1 store ────────────────────────────────────────────────────────────────

test("1.1 missions store opens twice on the same file (idempotent migrations)", () => {
  const file = path.join(mkdtempSync(path.join(tmp, "m-")), "wanxing.db");
  const a = createWanxingStore({ file });
  const m = a.missionCreate({ ownerId: 7, ownerEmail: OWNER.email, ...fourTuple() });
  a.close();
  const b = createWanxingStore({ file });
  assert.equal(b.missionGet(m.id).goal, "把 2026Q3 中国新能源车销量整理成一份带来源的简报");
  b.close();
});

test("1.1 invalid four-tuples never land a row", () => {
  const s = freshStore();
  for (const bad of [
    fourTuple({ goal: " " }),
    fourTuple({ costCapMinutes: 0 }),
    fourTuple({ windowEnd: Date.now() - 86_400_000 }),
    fourTuple({ approval: "maybe" }),
  ]) {
    assert.throws(() => s.missionCreate({ ownerId: 7, ownerEmail: OWNER.email, ...bad }));
  }
  assert.equal(s.missionList({}).length, 0);
});

test("1.1 spent derives from the ledger over mission_id (no counter)", () => {
  const s = freshStore();
  const m = s.missionCreate({ ownerId: 7, ownerEmail: OWNER.email, ...fourTuple() });
  assert.equal(s.missionSpent(m.id), 0);
  s.usageInsert({ id: "wu_a", callerId: 7, agentSlug: "x", startedAt: 0, endedAt: 65_000, durationMs: 65_000, outcome: "ok", minutesBilled: 2, rateUsd: 0.1, settlementStatus: "pending", missionId: m.id });
  s.usageInsert({ id: "wu_b", callerId: 7, agentSlug: "x", startedAt: 0, endedAt: 1_000, durationMs: 1_000, outcome: "ok", minutesBilled: 1, rateUsd: 0.1, settlementStatus: "pending", missionId: m.id });
  s.usageInsert({ id: "wu_c", callerId: 7, agentSlug: "x", startedAt: 0, endedAt: 1_000, durationMs: 1_000, outcome: "ok", minutesBilled: 99, rateUsd: 0.1, settlementStatus: "pending" });
  assert.equal(s.missionSpent(m.id), 3);
});

// ── 2.1 the transition table ────────────────────────────────────────────────

test("2.1 human path walks draft→…→reported with every step recorded", async () => {
  const h = appHarness();
  const { id, token, wb } = await drive(h, { approval: "human", to: "executing" });
  const rep = await wb("report", { summary: "done" }, "k-rep", token);
  assert.equal(rep.body.ok, true);
  const m = h.store.missionGet(id);
  assert.equal(m.status, "reported");
  const states = m.history.map((x) => x.to);
  assert.deepEqual(states, ["submitted", "planning", "awaiting_approval", "scheduled", "executing", "reported"]);
  await h.close();
});

test("2.1 auto path skips the human gate", async () => {
  const h = appHarness();
  const { id } = await drive(h, { approval: "auto", to: "scheduled" });
  assert.equal(h.store.missionGet(id).status, "scheduled");
  await h.close();
});

test("2.1 terminal states refuse every further transition", async () => {
  const h = appHarness();
  const { id, token, wb } = await drive(h, { to: "executing" });
  await wb("report", { summary: "done" }, "k-rep", token);
  const again = await wb("fail", { reason: "x" }, "k-after-terminal", token);
  assert.equal(again.status, 401); // token died with the terminal state
  const abort = await h.owner(`/api/wanxing/v1/console/missions/${id}/abort`, { method: "POST" });
  assert.equal(abort.status, 409);
  await h.close();
});

test("2.1 abort wins from any live state; optimistic concurrency loses as illegal", async () => {
  const s = freshStore();
  const m = s.missionCreate({ ownerId: 7, ownerEmail: OWNER.email, ...fourTuple() });
  s.missionTransition(m.id, "draft", "submitted", "owner", "go");
  s.missionTransition(m.id, "submitted", "planning", "system", "dispatch", { dispatchToken: "t1", dispatchTokenAt: 1 });
  // Same from-status twice: the second writer loses the race.
  const a = s.missionTransition(m.id, "planning", "failed", "planner", "first");
  const b = s.missionTransition(m.id, "planning", "aborted", "owner", "second");
  assert.ok(a);
  assert.equal(b, null);
  assert.equal(s.missionGet(m.id).status, "failed");
});

test("2.1 four-tuple is frozen once planning (no update surface exists)", async () => {
  const h = appHarness();
  const { id } = await drive(h, { to: "planning" });
  const put = await h.owner(`/api/wanxing/v1/console/missions/${id}`, { method: "PUT", body: JSON.stringify(fourTuple({ goal: "改目标" })) });
  assert.equal(put.status, 404); // the only mutation surfaces are the state-machine actions
  assert.equal(h.store.missionGet(id).goal.includes("新能源车销量"), true);
  await h.close();
});

// ── 3.1 dispatch ────────────────────────────────────────────────────────────

test("3.1 submit dispatches: planning, epoch token minted, brief carries the four-tuple", async () => {
  const h = appHarness();
  const { id } = await drive(h, { to: "planning" });
  const m = h.store.missionGet(id);
  assert.match(m.dispatchToken, /^mt_[0-9a-f]{48}$/);
  assert.equal(h.upstreamCalls.length, 1);
  const body = JSON.parse(h.upstreamCalls[0].body);
  const brief = body.params.message.parts[0].text;
  assert.ok(brief.includes(id));
  assert.ok(brief.includes("新能源车销量"));
  assert.ok(brief.includes(m.dispatchToken));
  assert.ok(brief.includes("/writeback"));
  assert.equal(body.params.message.context_id, `mission:${id}`);
  await h.close();
});

test("3.1 unconfigured planner refuses submit visibly; the draft survives", async () => {
  const h = appHarness({ plannerSlug: "" });
  const created = await h.owner("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(fourTuple()) });
  const id = created.body.mission.id;
  const refused = await h.owner(`/api/wanxing/v1/console/missions/${id}/submit`, { method: "POST" });
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error.code, "MISSING_PLANNER");
  assert.equal(h.store.missionGet(id).status, "draft");
  const listed = await h.owner("/api/wanxing/v1/console/missions");
  assert.equal(listed.body.plannerConfigured, false);
  await h.close();
});

test("3.1 an expired window refuses dispatch with the mission short of planning", async () => {
  const h = appHarness();
  const created = await h.owner("/api/wanxing/v1/console/missions", {
    method: "POST",
    body: JSON.stringify(fourTuple({ windowStart: Date.now() - 90_000, windowEnd: Date.now() - 60_000 })),
  });
  const id = created.body.mission.id;
  const refused = await h.owner(`/api/wanxing/v1/console/missions/${id}/submit`, { method: "POST" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, "MISSION_WINDOW_EXPIRED");
  assert.equal(h.store.missionGet(id).status, "draft");
  await h.close();
});

test("3.1 a dead upstream fails the mission after one retry", async () => {
  let calls = 0;
  const h = appHarness({ upstream: async () => { calls += 1; return new Response("nope", { status: 502 }); } });
  const { id } = await drive(h, { to: "draft" });
  await h.owner(`/api/wanxing/v1/console/missions/${id}/submit`, { method: "POST" });
  await h.waitFor(id, "failed");
  assert.equal(calls, 2); // one bounded retry
  const m = h.store.missionGet(id);
  assert.equal(m.status, "failed");
  assert.ok((m.history.at(-1)?.note || "").includes("dispatch failed"));
  await h.close();
});

test("3.1 an unknown planner deployment fails the mission without an upstream call", async () => {
  const h = appHarness({ plannerSlug: "packs-ghost-planner" });
  const { id } = await drive(h, { to: "draft" });
  await h.owner(`/api/wanxing/v1/console/missions/${id}/submit`, { method: "POST" });
  await h.waitFor(id, "failed");
  assert.equal(h.upstreamCalls.length, 0);
  await h.close();
});

// ── 3.2 writeback ───────────────────────────────────────────────────────────

test("3.2 writeback is token-gated; replay is idempotent; kinds respect the machine", async () => {
  const h = appHarness();
  const { id, token, wb } = await drive(h, { to: "planning" });

  const noToken = await h.json(`/api/wanxing/v1/missions/${id}/writeback`, {
    method: "POST", body: JSON.stringify({ kind: "plan", payload: { steps: [] }, idempotencyKey: "x" }),
  });
  assert.equal(noToken.status, 401);

  // A report before any plan is an illegal move, refused and RECORDED as such.
  const early = await wb("report", { summary: "过早" }, "k-early", token);
  assert.equal(early.status, 409);
  const earlyReplay = await wb("report", { summary: "过早" }, "k-early", token);
  assert.equal(earlyReplay.status, 409); // replays reproduce the refusal

  const plan = await wb("plan", { steps: [{ id: "s1", prompt: "a" }] }, "k-plan", token);
  assert.equal(plan.body.ok, true);
  assert.equal(plan.body.status, "awaiting_approval");
  // Same key replays the recorded result; the state does not move twice.
  const planReplay = await wb("plan", { steps: [{ id: "s1", prompt: "a" }] }, "k-plan", token);
  assert.deepEqual(planReplay.body, plan.body);
  assert.equal(h.store.missionGet(id).status, "awaiting_approval");

  // An invalid plan is refused before any state change.
  const badPlan = await wb("plan", { steps: [] }, "k-bad", token);
  assert.equal(badPlan.status, 400);
  assert.equal(badPlan.body.error.code, "BAD_PLAN");

  // A second mission's token never opens this mission's writeback.
  const other = await drive(h, { to: "planning" });
  const cross = await wb("plan", { steps: [{ id: "x", prompt: "y" }] }, "k-cross", other.token);
  assert.equal(cross.status, 401);
  await h.close();
});

test("3.2 step progress: the first running step opens executing, later ones are artifact-only", async () => {
  const h = appHarness();
  const { id, token, wb } = await drive(h, { approval: "auto", to: "scheduled" });
  // First running step = 首步开跑: the machine moves scheduled→executing.
  const step = await wb("step", { stepId: "s1", status: "running" }, "k-s1", token);
  assert.equal(step.body.ok, true, JSON.stringify(step.body));
  assert.equal(step.body.status, "executing");
  // Subsequent progress is artifact-only — the machine stays put.
  const step2 = await wb("step", { stepId: "s1", status: "done", note: "绿" }, "k-s1b", token);
  assert.equal(step2.body.ok, true);
  assert.equal(step2.body.status, "executing");
  const m = h.store.missionGet(id);
  const s1 = m.plan.steps.find((s) => s.id === "s1");
  assert.equal(s1.status, "done");
  assert.equal(s1.note, "绿");
  const ghost = await wb("step", { stepId: "nope", status: "x" }, "k-ghost", token);
  assert.equal(ghost.status, 400);
  await h.close();
});

// ── 4.1 the cost cap gates dispatch on the ledger ───────────────────────────

test("4.1 spent minutes accumulate from dispatch turns; an exhausted cap refuses the next submit", async () => {
  const h = appHarness();
  // Cap 1 minute; the dispatch turn records one ok minute (65s → 2 min ceil).
  const a = await drive(h, { to: "planning" }); // dispatch turn recorded with mission_id
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(h.store.missionSpent(a.id) >= 1, true);

  const created = await h.owner("/api/wanxing/v1/console/missions", {
    method: "POST",
    body: JSON.stringify(fourTuple({ costCapMinutes: 1 })),
  });
  const b = created.body.mission.id;
  // Seed the ledger to the cap exactly, then submit: refused at the gate.
  h.store.usageInsert({ id: `wu_${b}`, callerId: OWNER.userId, agentSlug: "planner", startedAt: 0, endedAt: 60_000, durationMs: 60_000, outcome: "ok", minutesBilled: 1, rateUsd: 0.1, settlementStatus: "pending", missionId: b });
  const refused = await h.owner(`/api/wanxing/v1/console/missions/${b}/submit`, { method: "POST" });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.error.code, "MISSION_EXHAUSTED");
  await h.close();
});

test("4.1 the cap never interrupts the running dispatch turn; mission rows settle locally", async () => {
  const h = appHarness();
  const { id } = await drive(h, { to: "planning" });
  await new Promise((r) => setTimeout(r, 30));
  // The dispatch turn completed and recorded despite cap=30; settlement is
  // the local mark (no sub2api movement for settler=mission rows).
  const row = h.store.usagePending().find((r) => r.mission_id === id);
  assert.ok(row, "dispatch turn recorded");
  assert.equal(row.settler, "mission");
  const settled = await h.core.trySettle({ ...row, callerId: row.caller_id, minutesBilled: row.minutes_billed, rateUsd: row.rate_usd, settler: row.settler });
  assert.equal(settled, true);
  assert.equal(h.sub.adjustCalls.length, 0); // no money moved — the deployment's lane paid upstream
  await h.close();
});

// ── 5.1 console surface ─────────────────────────────────────────────────────

test("5.1 owners see only their missions; ops sees all; detail hides the token", async () => {
  const h = appHarness();
  const { id, token } = await drive(h, { to: "planning" });
  const mine = await h.owner("/api/wanxing/v1/console/missions");
  assert.equal(mine.body.missions.length, 1);
  assert.equal(mine.body.missions[0].id, id);
  assert.equal("dispatchToken" in mine.body.missions[0], false);

  const stranger = h.json("/api/wanxing/v1/console/missions", { headers: { Authorization: "Bearer someone-else" } });
  assert.equal((await stranger).status, 401);

  const all = await h.ops("/api/wanxing/v1/console/missions");
  assert.equal(all.body.missions.length, 1);
  assert.equal(all.body.missions[0].ownerEmail, OWNER.email);

  const detail = await h.owner(`/api/wanxing/v1/console/missions/${id}`);
  assert.equal(detail.body.mission.dispatchToken, undefined);
  assert.ok(detail.body.mission.plan === null);
  await h.close();
});

test("5.1 approve only clears the human gate; abort is always available", async () => {
  const h = appHarness();
  const { id } = await drive(h, { to: "awaiting_approval" });
  const premature = await h.owner(`/api/wanxing/v1/console/missions/${id}/abort`, { method: "POST" });
  assert.equal(premature.body.ok, true);
  assert.equal(h.store.missionGet(id).status, "aborted");

  const { id: id2 } = await drive(h, { to: "awaiting_approval" });
  const ap = await h.owner(`/api/wanxing/v1/console/missions/${id2}/approve`, { method: "POST" });
  assert.equal(ap.body.status, "scheduled");
  const apAgain = await h.owner(`/api/wanxing/v1/console/missions/${id2}/approve`, { method: "POST" });
  assert.equal(apAgain.status, 409);
  await h.close();
});

test("5.1 creation needs an identity or an ownerEmail; ops creates on behalf", async () => {
  const h = appHarness();
  const opsBare = await h.ops("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(fourTuple()) });
  assert.equal(opsBare.status, 400); // ops without ownerEmail names no owner
  const opsUnknown = await h.ops("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify({ ...fourTuple(), ownerEmail: "nobody@x.y" }) });
  assert.equal(opsUnknown.status, 404);
  assert.equal(opsUnknown.body.code, "NO_SUB2API_ACCOUNT");
  const opsFor = await h.ops("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify({ ...fourTuple(), ownerEmail: OWNER.email }) });
  assert.equal(opsFor.status, 201);
  // The owner sees the ops-created mission as their own.
  const mine = await h.owner("/api/wanxing/v1/console/missions");
  assert.equal(mine.body.missions.length, 1);
  assert.equal(mine.body.missions[0].id, opsFor.body.mission.id);
  const bad = await h.owner("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(fourTuple({ costCapMinutes: 0 })) });
  assert.equal(bad.status, 400);
  await h.close();
});

// ── 6.1 lifecycle events ────────────────────────────────────────────────────

test("6.1 every transition lands one fleet event; a broken channel never blocks", async () => {
  let boom = false;
  const store = freshStore();
  const sub = stubSub2api();
  const events = [];
  const core = createWanxingCore({ store, sub2api: sub });
  const face = createMissionsFace({
    store, core,
    resolveDeployment: () => ({ agentPath: "/packs/pl/planner" }),
    forwardHeaders: () => ({}),
    config: { agentUrlFor: (p) => `https://x/agent${p}/`, writebackUrlFor: () => "https://x/wb" },
    report: (ev) => { if (boom) throw new Error("channel down"); events.push(ev); },
    env: { MISSION_PLANNER_SLUG: "packs-pl-planner" },
    upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  const m = store.missionCreate({ ownerId: 7, ownerEmail: OWNER.email, ...fourTuple() });
  const t1 = face.applyTransition(m, "submitted", "owner", OWNER.email);
  assert.equal(t1.ok, true);
  boom = true;
  const t2 = face.applyTransition(t1.mission, "aborted", "owner", OWNER.email);
  assert.equal(t2.ok, true); // the transition survived the broken channel
  boom = false;
  assert.deepEqual(events.map((e) => e.kind), ["mission.submitted"]);
  assert.ok(MISSION_TERMINAL.has("reported"));
});

// ── 3.3 the planner's read lane (human-approval poll) ───────────────────────

test("3.3 the planner polls mission state over the epoch token; approve unblocks", async () => {
  const h = appHarness();
  const { id, token, wb } = await drive(h, { to: "planning" });
  const plan = await wb("plan", { steps: [{ id: "s1", prompt: "a" }] }, "k-p", token);
  assert.equal(plan.body.status, "awaiting_approval");

  const read = (t) => h.json(`/api/wanxing/v1/missions/${id}/writeback`, { headers: { "X-Mission-Token": t } });
  const before = await read(token);
  assert.equal(before.body.status, "awaiting_approval");
  assert.equal(before.body.approval, "human");
  assert.equal("dispatchToken" in before.body, false); // the token never echoes

  const wrong = await read("mt_wrong");
  assert.equal(wrong.status, 401);

  await h.owner(`/api/wanxing/v1/console/missions/${id}/approve`, { method: "POST" });
  const after = await read(token);
  assert.equal(after.body.status, "scheduled");
  assert.equal(after.body.plan.steps.length, 1);

  // Terminal stays readable with the matching token (the final poll).
  await wb("step", { stepId: "s1", status: "running" }, "k-s", token);
  await wb("report", { summary: "done" }, "k-r", token);
  const terminal = await read(token);
  assert.equal(terminal.body.status, "reported");
  await h.close();
});
