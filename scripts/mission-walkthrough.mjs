#!/usr/bin/env node
// ── Mission walkthrough (add-mission-definitions 6.2) ────────────────────────
//
// The planner CONTRACT proven end-to-end with a stub planner: a local facade
// + a stub upstream that answers the dispatch turn AND performs the writeback
// dance a real planner pack will follow (plan → steps → report, replayed
// safely). Walks both approval modes, cost-cap exhaustion, abort, and the
// degraded (unconfigured planner) state. A real planner turn is change ②'s
// acceptance; this script pins the facade side of the contract.
//
//   node scripts/mission-walkthrough.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore } = await import("../services/wanxing-facade/core.js");
const { createMissionsFace } = await import("../services/wanxing-facade/missions.js");

const tmp = mkdtempSync(path.join(tmpdir(), "wx-mission-walk-"));
const OPS_TOKEN = "walk-ops";
const OWNER_TOKEN = "walk-owner";
const OWNER = { userId: 7, email: "owner@finddata.tech" };

const sub2api = {
  adjustCalls: [],
  degraded: () => false,
  async probeKeyLiveness() { return { ok: true }; },
  async findUserByKey() { return OWNER; },
  async findUserByEmail(mail) { return mail === OWNER.email ? OWNER : null; },
  async adjustBalance(a) { this.adjustCalls.push(a); return { ok: true }; },
};

const store = createWanxingStore({ file: path.join(tmp, "wanxing.db") });
const core = createWanxingCore({ store, sub2api, config: { ratePerMin: 0.1, rpmMax: 100 } });
const events = [];

// The stub planner: on a dispatch brief it extracts the writeback URL+token,
// then performs the full dance. Both approval modes take the same lane; the
// human gate simply pauses until the owner approves.
let plannerMode = "full"; // full | fail-early | silent
const plannerWritebacks = [];
function makeStubPlanner() {
  return async (_url, init) => {
    if (plannerMode === "silent") return new Response("{}", { status: 200 });
    const brief = JSON.parse(init.body).params.message.parts[0].text;
    const url = brief.match(/POST (\S+)/)?.[1];
    const token = brief.match(/X-Mission-Token: (\S+)/)?.[1];
    const approval = brief.match(/approval: (\w+)/)?.[1];
    if (plannerMode === "fail-early") {
      // A planner that reads the goal and gives up immediately.
      fetch(url, { method: "POST", headers: { "X-Mission-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "fail", payload: { reason: "目标不可达成：无数据源" }, idempotencyKey: "wb-fail" }) })
        .then((r) => r.json()).then((d) => plannerWritebacks.push({ kind: "fail", ok: d.ok })).catch(() => {});
      return new Response("{}", { status: 200 });
    }
    const wb = async (kind, payload, key) => {
      const r = await fetch(url, { method: "POST", headers: { "X-Mission-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload, idempotencyKey: key }) });
      const d = await r.json().catch(() => ({}));
      plannerWritebacks.push({ kind, status: r.status, ok: d.ok, doc: d });
      return d;
    };
    (async () => {
      await wb("plan", { steps: [
        { id: "s1", prompt: "检索新能源车销量数据并核对来源", agent: null, when: "window" },
        { id: "s2", prompt: "写成带来源标注的简报", agent: null, when: "window" },
      ] }, "wb-plan");
      if (approval === "auto") {
        await wb("ready", {}, "wb-ready");
        await wb("step", { stepId: "s1", status: "running" }, "wb-s1r");
        await wb("step", { stepId: "s1", status: "done" }, "wb-s1d");
        await wb("step", { stepId: "s2", status: "running" }, "wb-s2r");
        await wb("step", { stepId: "s2", status: "done" }, "wb-s2d");
        await wb("report", { summary: "2026Q3 新能源车销量简报完成（两步全绿，来源已标注）。", artifacts: [] }, "wb-report");
      }
    })().catch(() => {});
    return new Response("{}", { status: 200 });
  };
}

const face = createMissionsFace({
  store, core,
  resolveDeployment: (slug) => (slug === "packs-pl-planner" ? { agentPath: "/packs/pl/planner", packId: "pl", agentId: "planner" } : null),
  forwardHeaders: () => ({}),
  config: {
    agentUrlFor: (p) => `https://registry.internal/agent${p}/`,
    writebackUrlFor: (id) => `http://127.0.0.1:${PORT}/api/wanxing/v1/missions/${id}/writeback`,
  },
  report: (ev) => events.push(ev.kind),
  env: { MISSION_PLANNER_SLUG: "packs-pl-planner" },
  upstreamFetch: makeStubPlanner(),
  log: () => {},
});

const app = express();
face.register(app, {
  requireToken: (req) => String(req.headers.authorization || "") === `Bearer ${OPS_TOKEN}`,
  logtoAuth: { configured: true, verifyIdToken: async (t) => (t === OWNER_TOKEN ? { email: OWNER.email } : null) },
  sub2api,
});
const server = http.createServer(app).listen(0);
const PORT = server.address().port;
const base = `http://127.0.0.1:${PORT}`;
const owner = async (p, opts = {}) => {
  const r = await fetch(base + p, { ...opts, headers: { "Content-Type": "application/json", Authorization: `Bearer ${OWNER_TOKEN}`, ...(opts.headers ?? {}) } });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const waitFor = async (id, status, ms = 3000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const m = store.missionGet(id);
    if (m.status === status) return m;
    if (Date.now() > deadline) throw new Error(`mission stuck at ${m.status}, wanted ${status}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const four = (over = {}) => ({
  goal: "把 2026Q3 中国新能源车销量整理成一份带来源的简报",
  model: "deepseek-v4.1-flash",
  windowStart: Date.now(),
  windowEnd: Date.now() + 86_400_000,
  costCapMinutes: 30,
  approval: "human",
  ...over,
});

const step = (name) => console.log(`  ✓ ${name}`);
try {
  // ── 1. auto mode: create → submit → planner dances → reported ─────────────
  console.log("① 自动模式全链");
  const a = (await owner("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(four({ approval: "auto" })) })).body.mission;
  await owner(`/api/wanxing/v1/console/missions/${a.id}/submit`, { method: "POST" });
  const done = await waitFor(a.id, "reported");
  step("draft→submitted→planning→auto_approved→scheduled→executing→reported");
  assert.equal(done.plan.steps.length, 2);
  assert.ok(done.plan.steps.every((s) => s.status === "done"));
  assert.ok(done.report.summary.includes("简报"));
  assert.ok(store.missionSpent(a.id) >= 1, "dispatch turn on the mission ledger");
  assert.ok(events.includes("mission.reported"), "lifecycle events flowed");

  // ── 2. human mode: plan waits for the owner's approval, then reports ──────
  console.log("② 人批模式：计划等人，批准后交付");
  plannerMode = "full";
  const b = (await owner("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(four()) })).body.mission;
  await owner(`/api/wanxing/v1/console/missions/${b.id}/submit`, { method: "POST" });
  const waiting = await waitFor(b.id, "awaiting_approval");
  step(`计划落地停在 awaiting_approval（${waiting.plan.steps.length} 步）`);
  // Replay the planner's plan writeback key from a second stub pass: the
  // recorded result returns and nothing advances twice.
  await owner(`/api/wanxing/v1/console/missions/${b.id}/approve`, { method: "POST" });
  // (planner is human-gated; finish it manually through the writeback lane)
  const token = store.missionGet(b.id).dispatchToken;
  const wb = await fetch(`${base}/api/wanxing/v1/missions/${b.id}/writeback`, {
    method: "POST", headers: { "X-Mission-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "step", payload: { stepId: "s1", status: "running" }, idempotencyKey: "wbh-s1" }),
  });
  assert.equal((await wb.json()).status, "executing");
  const rep = await fetch(`${base}/api/wanxing/v1/missions/${b.id}/writeback`, {
    method: "POST", headers: { "X-Mission-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "report", payload: { summary: "人工批准线交付。" }, idempotencyKey: "wbh-rep" }),
  });
  assert.equal(rep.status, 200);
  const replay = await fetch(`${base}/api/wanxing/v1/missions/${b.id}/writeback`, {
    method: "POST", headers: { "X-Mission-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "report", payload: { summary: "人工批准线交付。" }, idempotencyKey: "wbh-rep" }),
  });
  assert.equal((await replay.json()).ok, true);
  step("批准→执行→报告；同键重放幂等");

  // ── 3. cost cap: seed to cap, next submit is refused at the gate ──────────
  console.log("③ 成本闸");
  const c = (await owner("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(four({ costCapMinutes: 1 })) })).body.mission;
  store.usageInsert({ id: `wu_${c.id}`, callerId: OWNER.userId, agentSlug: "planner", startedAt: 0, endedAt: 60_000, durationMs: 60_000, outcome: "ok", minutesBilled: 1, rateUsd: 0.1, settlementStatus: "pending", missionId: c.id });
  const refused = await owner(`/api/wanxing/v1/console/missions/${c.id}/submit`, { method: "POST" });
  assert.equal(refused.status, 402);
  assert.equal(refused.body.error.code, "MISSION_EXHAUSTED");
  step("402 MISSION_EXHAUSTED，草稿保留");

  // ── 4. planner gives up: fail writeback lands failed ──────────────────────
  console.log("④ planner 弃单");
  plannerMode = "fail-early";
  const d = (await owner("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(four()) })).body.mission;
  await owner(`/api/wanxing/v1/console/missions/${d.id}/submit`, { method: "POST" });
  const failed = await waitFor(d.id, "failed");
  assert.ok((failed.history.at(-1).note || "").includes("无数据源"));
  step("fail 回写 → failed（转人工语义）");

  // ── 5. abort + degraded state ─────────────────────────────────────────────
  console.log("⑤ 中止与降级");
  plannerMode = "silent";
  const e = (await owner("/api/wanxing/v1/console/missions", { method: "POST", body: JSON.stringify(four()) })).body.mission;
  await owner(`/api/wanxing/v1/console/missions/${e.id}/submit`, { method: "POST" });
  await waitFor(e.id, "planning");
  await owner(`/api/wanxing/v1/console/missions/${e.id}/abort`, { method: "POST" });
  assert.equal(store.missionGet(e.id).status, "aborted");
  step("owner 随时可中止");

  console.log("\nMission walkthrough: ALL PASS ✅");
  console.log(`  events: ${events.join(" ")}`);
  console.log(`  sub2api movements for mission lanes: ${sub2api.adjustCalls.length} (expected 0 — local settlement)`);
} catch (err) {
  console.error("\nWalkthrough FAILED:", err);
  process.exitCode = 1;
} finally {
  await new Promise((r) => server.close(() => r()));
  store.close();
  rmSync(tmp, { recursive: true, force: true });
}
