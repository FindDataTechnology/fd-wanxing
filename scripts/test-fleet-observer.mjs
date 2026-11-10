#!/usr/bin/env node
// ── fleet-observer tests (add-fleet-event-backbone 1.x, 2.x, 4.1, 5.x) ──────
//
// In-process suite against createObserver with a tmp data root: ingest auth
// and idempotency, retention, rollup idempotence and buckets, board fields
// (five-state synthesis, dual runner, wake percentiles, lag bases, settled
// pending), timeline, and the bookkeeper's registry diff (baseline,
// deploy/undeploy/upgrade/pause, empty-flap guard).
//
//   node --test scripts/test-fleet-observer.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { test } from "node:test";

const { createObserver } = await import("../services/fleet-observer/observer.js");
const { ulid } = await import("../services/fleet-observer/ulid.js");
const { diffRows } = await import("../services/fleet-observer/bookkeeper.js");

const tmp = mkdtempSync(path.join(tmpdir(), "fleet-observer-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const TOKEN = "test-token";
let clockMs = 1_800_001_234_567; // mid-hour base (events "before now" stay in the same rollup hour)
const now = () => clockMs;

function harness({ registry = null } = {}) {
  const obs = createObserver({
    dataRoot: path.join(tmp, `d-${Math.random().toString(36).slice(2)}`),
    ingestToken: TOKEN,
    now,
    ...(registry ? { registryUrl: "https://reg.test", registryToken: "rt", fetchImpl: registry, pollIntervalMs: 10 ** 9 } : {}),
  });
  const srv = http.createServer(obs.app);
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => resolve({ obs, srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const ev = (over = {}) => ({
  id: ulid(now()), source: "runner:cheap1", agent: "packs-p1-deployments-a1",
  runner: "cheap1", kind: "turn_started", ts: now(), payload: {}, ...over,
});

async function post(base, body, token = TOKEN) {
  return fetch(`${base}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: token ? `Bearer ${token}` : "" },
    body: JSON.stringify(body),
  });
}

test("ingest: auth gate, batch validation, idempotent replay", async () => {
  const { obs, srv, base } = await harness();
  try {
    assert.equal((await post(base, { events: [ev()] }, "")).status, 401);
    assert.equal((await post(base, { events: [ev()] }, "wrong")).status, 401);
    assert.equal((await post(base, {})).status, 400);
    assert.equal((await post(base, { events: [{ id: "x", source: "s", agent: "a", kind: "nope", ts: 1 }] })).status, 400);

    const e1 = ev();
    const e2 = ev();
    const r1 = await post(base, { events: [e1, e2] });
    assert.deepEqual(await r1.json(), { accepted: 2, duplicates: 0 });
    // at-least-once replay of the SAME batch → zero new rows
    const r2 = await post(base, { events: [e1, e2] });
    const j2 = await r2.json();
    assert.equal(j2.accepted + j2.duplicates, 2);
    assert.equal(j2.accepted, 0);
  } finally {
    obs.close(); srv.close();
  }
});

test("rollup: buckets exact and recompute idempotent; retention keeps rollups", async () => {
  const { obs, srv, base } = await harness();
  try {
    const t0 = now();
    await post(base, { events: [
      ev({ kind: "turn_started", ts: t0 - 1000, payload: { wake_ms: 100 } }),
      ev({ kind: "turn_started", ts: t0 - 900, payload: { wake_ms: 900 } }),
      ev({ kind: "turn_started", ts: t0 - 950, payload: { wake_ms: 500 } }),
      ev({ kind: "turn_ended", ts: t0 - 500, payload: { outcome: "ok", duration_ms: 500 } }),
      ev({ kind: "turn_ended", ts: t0 - 400, payload: { outcome: "error", duration_ms: 100 } }),
      ev({ kind: "settled", ts: t0 - 300, payload: { minutes_billed: 1, usd: 0.5, settlement_status: "settled" } }),
      ev({ kind: "budget_killed", ts: t0 - 200, payload: {} }),
      ev({ kind: "paused", ts: t0 - 660_000 }),
      ev({ kind: "resumed", ts: t0 - 60_000 }),
      ev({ kind: "reaped", ts: t0 - 10, payload: { reason: "budget" } }),
    ] });
    const pass1 = obs.rollupPass(48);
    assert.ok(pass1.agents >= 1);
    const key = new Date(t0).toISOString().slice(0, 13) + ":00";
    const rows1 = obs.store.rollupRows([key]);
    const r = rows1.find((x) => x.agent === "packs-p1-deployments-a1");
    assert.deepEqual(
      { turns: r.turns, errors: r.errors, kills: r.budget_kills },
      { turns: 2, errors: 1, kills: 1 },
    );
    assert.equal(r.wake_p50_ms, 500);
    assert.equal(r.wake_p95_ms, 900);
    assert.ok(r.paused_minutes > 9 && r.paused_minutes <= 10.5, `paused_minutes=${r.paused_minutes}`);
    // idempotent recompute: same values, not doubled
    obs.rollupPass(48);
    const r2 = obs.store.rollupRows([key]).find((x) => x.agent === "packs-p1-deployments-a1");
    assert.equal(r2.turns, r.turns);
    // retention removes old raw rows but keeps rollups
    clockMs += 20 * 24 * 3600_000;
    const deleted = obs.store.retain(now(), 14 * 24 * 3600_000);
    assert.ok(deleted >= 10);
    assert.ok(obs.store.rollupRows([key]).length > 0);
  } finally {
    obs.close(); srv.close(); clockMs = 1_800_001_234_567;
  }
});

test("board: five-state synthesis, dual runner, wake, lag bases, settled pending", async () => {
  const { obs, srv, base } = await harness();
  try {
    const t0 = now();
    const mk = (agent, over = {}) => ev({ agent, runner: over.runner ?? "cheap1", ...over });
    await post(base, { events: [
      mk("packs-a-deployments-agent", { kind: "deployed", ts: t0 - 700 }), // agent A exists
      mk("packs-a-deployments-agent", { kind: "state_changed", ts: t0 - 500, payload: { from: "starting", to: "resident" } }),
      mk("packs-b-deployments-agent", { kind: "state_changed", ts: t0 - 500, payload: { from: "warm", to: "paused" } }),
      mk("packs-c-deployments-agent", { kind: "turn_started", ts: t0 - 400, payload: { wake_ms: 700 } }),
      mk("packs-d-deployments-agent", { kind: "settled", ts: t0 - 300, payload: { settlement_status: "pending", usd: 1.25, minutes_billed: 2 } }),
      mk("packs-a-deployments-agent", { kind: "runner_stats", ts: t0 - 100, runner: "cheap1", payload: { budget_mb: 300, budget_mb_limit: 512, children: 2 } }),
      mk("packs-a-deployments-agent", { kind: "runner_stats", ts: t0 - 90, runner: "cheap2", payload: { budget_mb: 100, budget_mb_limit: 512, children: 1 } }),
    ] });
    const board = await (await fetch(`${base}/api/fleet/v1/board`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    assert.equal(board.agents_total, 4);
    assert.deepEqual(
      { serving: board.states.serving, resident: board.states.resident, paused: board.states.paused },
      { serving: 1, resident: 1, paused: 1 },
    );
    assert.equal(board.wake_ms.p50, 700);
    assert.equal(board.settled_pending.count, 1);
    assert.equal(board.settled_pending.usd, 1.25);
    // dual runner: both stats present, grouped by runner identity
    assert.ok(board.runners.cheap1 && board.runners.cheap2);
    assert.equal(board.runners.cheap2.children, 1);
    // lag: both bases present; arrival age uses the observer clock
    const lag = board.ingest_lag.find((l) => l.source === "runner:cheap1");
    assert.ok(lag && lag.event_age_ms > 0 && lag.arrival_age_ms >= 0);
    // board without token → 401
    assert.equal((await fetch(`${base}/api/fleet/v1/board`)).status, 401);
  } finally {
    obs.close(); srv.close();
  }
});

test("timeline: agent-scoped, desc, since/limit honored", async () => {
  const { obs, srv, base } = await harness();
  try {
    const t0 = now();
    await post(base, { events: [
      ev({ kind: "deployed", ts: t0 - 3000 }),
      ev({ kind: "woken", ts: t0 - 2000 }),
      ev({ kind: "turn_started", ts: t0 - 1000, trace_id: "tr-1" }),
      ev({ kind: "turn_ended", ts: t0 - 500, trace_id: "tr-1", payload: { duration_ms: 500, outcome: "ok" } }),
      ev({ agent: "packs-other-deployments-agent", kind: "deployed", ts: t0 - 400 }),
    ] });
    const tl = await (await fetch(`${base}/api/fleet/v1/agents/packs-p1-deployments-a1/timeline?limit=2`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    assert.equal(tl.events.length, 2);
    assert.ok(tl.events[0].ts >= tl.events[1].ts);
    assert.ok(tl.events.every((e) => e.agent === "packs-p1-deployments-a1"));
    const since = await (await fetch(`${base}/api/fleet/v1/agents/packs-p1-deployments-a1/timeline?since=${t0 - 1500}`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
    assert.ok(since.events.every((e) => e.ts >= t0 - 1500));
    // turn events carry the trace_id reference, never turn content
    assert.equal(since.events.find((e) => e.kind === "turn_started")?.trace_id, "tr-1");
  } finally {
    obs.close(); srv.close();
  }
});

// ── bookkeeper: registry-list diff synthesis ─────────────────────────────────

const entry = (id, over = {}) => ({
  path: `/packs/${id}/deployments/agent`,
  name: `A ${id}`,
  is_enabled: true,
  supported_protocol: "a2a",
  metadata: { packId: id, packVersion: "1", ...(over.metadata ?? {}) },
  ...over,
});

function regServer() {
  let doc = { agents: [] };
  const impl = async (url) => {
    if (!String(url).includes("/api/agents")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(doc), { status: 200 });
  };
  return { impl, set: (agents) => (doc = { agents }) };
}

test("bookkeeper: baseline silent, then deploy/upgrade/pause/undeploy; empty-flap guarded", async () => {
  const reg = regServer();
  const { obs, srv, base } = await harness({ registry: reg.impl });
  try {
    // first poll = baseline, emits nothing
    reg.set([entry("p1")]);
    await obs.bookkeeper.poll();
    assert.equal(obs.store.rawSince(0).length, 0);

    // deploy p2, pause p1 → 3 events (deployed + paused + nothing for p1 identity)
    reg.set([entry("p1", { metadata: { packId: "p1", packVersion: "1", paused: true } }), entry("p2")]);
    await obs.bookkeeper.poll();
    let evs = obs.store.rawSince(0).map((e) => `${e.kind}:${e.agent}`);
    assert.ok(evs.includes("deployed:packs-p2-deployments-agent"));
    assert.ok(evs.includes("paused:packs-p1-deployments-agent"));

    // upgrade p2 (version bump) + resume p1
    reg.set([entry("p1"), entry("p2", { metadata: { packId: "p2", packVersion: "2" } })]);
    await obs.bookkeeper.poll();
    evs = obs.store.rawSince(0).map((e) => `${e.kind}:${e.agent}`);
    assert.ok(evs.includes("resumed:packs-p1-deployments-agent"));
    const up = evs.filter((x) => x.startsWith("deployed:packs-p2")).length;
    assert.equal(up, 2); // initial deploy + upgrade re-announce

    // empty registry list after a healthy snapshot: flap, no mass undeploy
    reg.set([]);
    await obs.bookkeeper.poll();
    assert.ok(!obs.store.rawSince(0).some((e) => e.kind === "undeployed"));

    // confirmed removal (non-empty next read without p2): undeployed fires
    reg.set([entry("p1")]);
    await obs.bookkeeper.poll();
    assert.ok(obs.store.rawSince(0).some((e) => e.kind === "undeployed" && e.agent === "packs-p2-deployments-agent"));
    assert.equal(obs.bookkeeper.knownSet().size, 1);
  } finally {
    obs.close(); srv.close();
  }
});

test("diffRows: buckets + canonical compare (shared copy of paas logic)", () => {
  const d = diffRows(
    [{ path: "/a", v: 1 }, { path: "/b", v: 2 }],
    [{ path: "/a", v: 1 }, { v: 2, path: "/b" }, { path: "/c", v: 3 }],
    (r) => r.path,
  );
  assert.equal(d.added.length, 1);
  assert.equal(d.removed.length, 0);
  assert.equal(d.changed.length, 0);
});

// ── add-mission-board: mission events ingest + board synthesis ───────────────

test("add-mission-board: mission transitions ingest and synthesize onto the board", async () => {
  const { obs, srv, base } = await harness();
  try {
    const msn = (kind, over = {}) => ev({ kind, ...over });
    // The pre-change reject surface: unknown mission kinds still refuse.
    assert.equal((await post(base, { events: [msn("mission.unknown")] })).status, 400);
    const ok = await post(base, { events: [
      msn("mission.submitted", { id: ulid(now()), payload: { mission: "msn_a", owner: "o@x.y" } }),
      msn("mission.planning", { id: ulid(now()), payload: { mission: "msn_a", owner: "o@x.y" } }),
      msn("mission.executing", { id: ulid(now()), payload: { mission: "msn_a", owner: "o@x.y" } }),
      msn("mission.reported", { id: ulid(now()), payload: { mission: "msn_a", owner: "o@x.y", spent: 5 } }),
    ] });
    assert.equal(ok.status, 200);
    const r = await fetch(`${base}/api/fleet/v1/board`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const board = await r.json();
    assert.equal(board.missions.length, 1);
    const m = board.missions[0];
    assert.equal(m.id, "msn_a");
    assert.equal(m.status, "reported");
    assert.equal(m.spent, 5);
    assert.deepEqual(m.trail, ["submitted", "planning", "executing", "reported"]);
  } finally {
    obs.close(); srv.close();
  }
});

test("add-mission-board: an empty window keeps the missions segment present", async () => {
  const { obs, srv, base } = await harness();
  try {
    const r = await fetch(`${base}/api/fleet/v1/board`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const board = await r.json();
    assert.deepEqual(board.missions, []);
  } finally {
    obs.close(); srv.close();
  }
});

// ── add-fleet-cell-views: cell short-term telemetry on the board ────────────

test("add-fleet-cell-views: cell_stats ingest and synthesize cells/shortterm", async () => {
  const { obs, srv, base } = await harness();
  try {
    // A resident-agent turn keeps the legacy scopes alive alongside the new kind.
    await post(base, { events: [ev()] });
    await post(base, {
      events: [
        ev({ id: ulid(now()), source: "cell-sampler", agent: "cell:a@x.test", runner: null, kind: "cell_stats", payload: { jobs: 3, executions: { running: 1, queued: 2 }, workers: { cap: 4, busy: 1, idle: 3 }, recent: { done: 5, failed: 1, interrupted: 0 }, agentBusy: true } }),
        ev({ id: ulid(now()), source: "cell-sampler", agent: "cell:b@x.test", runner: null, kind: "cell_stats", payload: { jobs: 0, executions: { running: 0, queued: 1 }, workers: { cap: 0, busy: 0, idle: 0 }, recent: { done: 0, failed: 0, interrupted: 0 }, agentBusy: false } }),
        // fresher snapshot for the SAME cell wins (latest-wins watermark)
        ev({ id: ulid(now()), source: "cell-sampler", agent: "cell:a@x.test", runner: null, kind: "cell_stats", ts: now() + 1000, payload: { jobs: 3, executions: { running: 0, queued: 0 }, workers: { cap: 4, busy: 0, idle: 3 }, recent: { done: 6, failed: 1, interrupted: 0 }, agentBusy: false } }),
      ],
    });
    const r = await fetch(`${base}/api/fleet/v1/board`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const b = await r.json();
    assert.deepEqual(Object.keys(b.cells).sort(), ["cell:a@x.test", "cell:b@x.test"]);
    assert.equal(b.cells["cell:a@x.test"].jobs, 3); // freshest payload
    assert.equal(b.cells["cell:a@x.test"].executions.running, 0);
    assert.deepEqual(b.shortterm, { cells: 2, running: 0, queued: 1, workers_busy: 0, workers_idle: 3, workers_cap: 4 });
    // Resident scopes stay clean: the two cell identities never count as agents.
    assert.equal(b.agents_total, 1);
    assert.equal(b.states.unknown + b.states.serving + b.states.resident, 1);
  } finally {
    obs.shutdown?.();
    srv.close();
  }
});

test("add-fleet-cell-views: empty window keeps segments present and zero", async () => {
  const { obs, srv, base } = await harness();
  try {
    const r = await fetch(`${base}/api/fleet/v1/board`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const b = await r.json();
    assert.deepEqual(b.cells, {});
    assert.deepEqual(b.shortterm, { cells: 0, running: 0, queued: 0, workers_busy: 0, workers_idle: 0, workers_cap: 0 });
  } finally {
    obs.shutdown?.();
    srv.close();
  }
});

test("add-fleet-cell-views: unknown kinds still refused (whitelist stays enumerated)", async () => {
  const { obs, srv, base } = await harness();
  try {
    const r = await post(base, { events: [ev({ kind: "cell_stat" })] }); // near-miss kind
    assert.equal(r.status, 400);
  } finally {
    obs.shutdown?.();
    srv.close();
  }
});

// ── add-fleet-cockpit-projection: cell_fleets kind + cell-fleets read face ──

test("projection: cell_fleets ingests, is synthesized latest-wins per cell, staleness flag; unknown kinds still 400", async () => {
  const { obs, srv, base } = await harness();
  try {
    // Unknown kind still refuses (whitelist enumerable).
    const bad = await post(base, { events: [ev({ kind: "cell_fleetz" })] });
    assert.equal(bad.status, 400);

    const snap = (cell, tag, ts, sampledAt = ts) => ev({
      id: ulid(ts) + tag, source: "cell-sampler", agent: cell, runner: null, kind: "cell_fleets", ts,
      payload: { v: 1, sampledAt, fleets: [{ id: `f-${cell}-${tag}`, name: "甲队", state: "active", counts: { onDuty: 2, total: 3 }, openDecisions: { count: 1, top: [{ question: "拍我吗", severity: "high", expiresAt: ts + 3600_000, memberTitle: "CEO" }] }, stream: [{ title: "CEO", status: "on_duty", at: sampledAt, source: "self", metrics: {}, summarySnip: "x" }] }] },
    });
    await post(base, {
      events: [
        snap("cell:a@x.test", "old", now() - 120_000),
        snap("cell:a@x.test", "new", now() - 10_000),
        snap("cell:b@x.test", "stale", now() - 2 * 3600_000),
      ],
    });

    const anon = await fetch(`${base}/api/fleet/v1/cell-fleets`);
    assert.equal(anon.status, 401);

    const r = await fetch(`${base}/api/fleet/v1/cell-fleets`, { headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.deepEqual(Object.keys(b.cells).sort(), ["cell:a@x.test", "cell:b@x.test"]);

    const a = b.cells["cell:a@x.test"];
    assert.equal(a.fleets[0].id.endsWith("new"), true, "latest snapshot wins");
    assert.equal(a.stale, false);
    assert.equal(a.fleets[0].openDecisions.top[0].question, "拍我吗", "payload verbatim");

    const c = b.cells["cell:b@x.test"];
    assert.equal(c.stale, true, ">3×tick sample age reads stale");
    assert.ok(c.ageMs >= 2 * 3600_000);
  } finally {
    obs.shutdown?.();
    srv.close();
  }
});

// ── storage-longevity 1.1: progress-driven rollup catch-up ──────────────────
test("rollup progress: a rewound progress row heals the hole in one pass; kill+rerun does not double", async () => {
  const { obs, srv } = await harness();
  try {
    const t0 = now();
    // Two turns in DIFFERENT hours, 72h apart.
    const oldHour = t0 - 72 * 3600_000 - 60_000;
    obs.store.insertMany([
      { id: "old-1", source: "runner:cheap1", agent: "packs-p1-deployments-a1", kind: "turn_ended", ts: oldHour, ingested_at: t0, payload: JSON.stringify({ outcome: "ok" }) },
      { id: "now-1", source: "runner:cheap1", agent: "packs-p1-deployments-a1", kind: "turn_ended", ts: t0 - 500, ingested_at: t0, payload: JSON.stringify({ outcome: "ok" }) },
    ], t0);
    // Simulate 72h of observer downtime: progress froze at the hour of the
    // old event. Everything after it is a hole the pass must heal.
    const progressHour = new Date(oldHour).toISOString().slice(0, 13) + ":00";
    obs.store.metaSet("rollup_progress_hour", progressHour);
    const before = obs.store.rollupRows([new Date(oldHour).toISOString().slice(0, 13) + ":00"]);
    assert.equal(before.length, 0, "hole exists before the pass");

    const pass = obs.rollupPass();
    assert.ok(pass.catchUp >= 2, `catch-up walked the gap (${pass.catchUp})`);
    const healed = obs.store.rollupRows([new Date(oldHour).toISOString().slice(0, 13) + ":00"]);
    assert.equal(healed.length, 1, "72h-old bucket healed");
    assert.equal(healed[0].turns, 1);

    // Kill+rerun: idempotent overwrite, no doubling.
    const pass2 = obs.rollupPass();
    const healed2 = obs.store.rollupRows([new Date(oldHour).toISOString().slice(0, 13) + ":00"]);
    assert.equal(healed2[0].turns, 1);
    assert.equal(pass2.catchUp, 0, "second pass is fully caught up");
    assert.equal(obs.store.metaGet("rollup_progress_hour"), new Date(now() - 3600_000).toISOString().slice(0, 13) + ":00");
  } finally { obs.close(); srv.close(); }
});

test("rollup progress: first run on a fresh store is retention-bounded and completes", async () => {
  const { obs, srv } = await harness();
  try {
  const pass = obs.rollupPass();
  // 336 buckets + current = the whole window walked once, no rescan loop
  assert.ok(pass.catchUp > 300 && pass.catchUp <= 337, `bounded first walk (${pass.catchUp})`);
  const pass2 = obs.rollupPass();
  assert.equal(pass2.catchUp, 0, "second pass caught up");
  } finally { obs.close(); srv.close(); }
});

// ── ingest 白名单必须覆盖 facade 实际发出的每个 kind（跨进程契约）────────────
//
// 2026-11-10 生产事故：facade 的嵌入车道开始发 `kind:"minted"`，而这里没同步
// 加进 EVENT_KINDS。ingest 遇到未知 kind 是**整批 400**，于是每次 flush 都带着
// 一条 minted 被全批拒掉 —— facade 的 spool 从 138 涨到 340 行，日志只有
// "flush refused (400)"（响应体被丢弃，看不到原因）。
//
// 这条测试静态扫 facade 的源码，把每个 `note("<kind>")` 字面量都对白名单核一遍：
// 发端新增 kind 而收端没跟，CI 立刻红，不再等到 spool 涨满才被人发现。
test("contract: every kind the facade emits is accepted by ingest", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../services/wanxing-facade/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  const emitted = new Map(); // kind -> [file:line]
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), "utf8");
    src.split("\n").forEach((line, i) => {
      // The facade's only event emitter is the `note(kind, agent, payload)` helper
      // (chat.js / a2a.js / cluster.js all wrap the same reporter call).
      for (const m of line.matchAll(/note\(\s*"([a-z_.]+)"/g)) {
        if (!emitted.has(m[1])) emitted.set(m[1], []);
        emitted.get(m[1]).push(`${f}:${i + 1}`);
      }
      for (const m of line.matchAll(/kind:\s*"(runner_stats|cell_stats|cell_fleets)"/g)) {
        if (!emitted.has(m[1])) emitted.set(m[1], []);
        emitted.get(m[1]).push(`${f}:${i + 1}`);
      }
    });
  }
  assert.ok(emitted.size >= 5, `facade emitters found (${emitted.size}) — the scan itself must not go blind`);

  const { EVENT_KINDS } = await import("../services/fleet-observer/store.js");
  const allowed = new Set(EVENT_KINDS);
  const missing = [...emitted.keys()].filter((k) => !allowed.has(k) && !k.startsWith("mission."));
  assert.deepEqual(
    missing,
    [],
    `facade emits kind(s) the observer rejects with 400 (one such event blocks the whole batch):\n` +
      missing.map((k) => `  ${k} ← ${emitted.get(k).join(", ")}`).join("\n"),
  );
});

// ── The borrowed boundary: the agent-runner also emits into this whitelist ──
//
// ADR-0005 keeps the runner in paas, so the scan above (which walks this repo's
// facade sources) structurally cannot see it. Measured 2026-11-10: three
// runner-emitted kinds were absent from EVENT_KINDS, the oldest since
// 2026-10-06 — each one refuses its whole batch and wedges the runner's spool.
// This scan runs against the sibling checkout when it exists. When it does not
// exist (this repo alone in CI), the test SKIPS with that reason rather than
// passing: "did not look" must never be reported as "found nothing".
test("contract: every kind the agent-runner emits is accepted by ingest", async (t) => {
  const { existsSync, readFileSync, readdirSync } = await import("node:fs");
  const runnerDir = new URL("../../paas/agent-runner/", import.meta.url);
  if (!existsSync(runnerDir)) {
    return t.skip("paas/agent-runner not checked out beside this repo — the borrowed-boundary contract was NOT verified");
  }
  const emitted = new Map(); // kind -> [file:line]
  for (const f of readdirSync(runnerDir).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(new URL(f, runnerDir), "utf8");
    src.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/#fleetEmit\(\s*"([a-z_.]+)"/g)) {
        if (!emitted.has(m[1])) emitted.set(m[1], []);
        emitted.get(m[1]).push(`${f}:${i + 1}`);
      }
    });
  }
  assert.ok(emitted.size >= 5, `runner emitters found (${emitted.size}) — the scan itself must not go blind`);

  const { EVENT_KINDS } = await import("../services/fleet-observer/store.js");
  const allowed = new Set(EVENT_KINDS);
  const missing = [...emitted.keys()].filter((k) => !allowed.has(k));
  assert.deepEqual(
    missing,
    [],
    `agent-runner emits kind(s) the observer rejects with 400 (one such event blocks the whole batch):\n` +
      missing.map((k) => `  ${k} ← ${emitted.get(k).join(", ")}`).join("\n"),
  );
});

test("contract: an unknown kind still 400s, and the 400 body names the offender", async () => {
  const { obs, srv, base } = await harness();
  try {
    const bad = { id: "x1", source: "facade", agent: "a", kind: "definitely_not_a_kind", ts: 1 };
    const res = await post(base, { events: [{ ...ev() }, bad] });
    assert.equal(res.status, 400, "unknown kind rejects the batch");
    const body = await res.json();
    assert.match(String(body.error), /definitely_not_a_kind/, "the response names the offending event");
  } finally {
    obs.close(); srv.close();
  }
});

// ── Retention is a PASS, not a function (add-agent-led-multi-host-lease 0.2) ──
//
// The earlier "retention keeps rollups" test calls obs.store.retain() DIRECTLY,
// so it stayed green for days while production never invoked it: the call was
// dropped when the rollup timer was rewritten (20fcb86). A test that reaches
// past the scheduler cannot tell you the scheduler calls anything — these drive
// the real beat.
test("maintenance: the scheduled pass actually expires raw events and keeps rollups", async () => {
  const { obs, srv } = await harness();
  try {
    const t0 = now();
    obs.store.insertMany([ev({ id: ulid(t0), ts: t0 })], t0);
    const key = new Date(t0).toISOString().slice(0, 13) + ":00";
    obs.rollupPass(48);
    const rollupsBefore = obs.store.rollupRows([key]).length;
    assert.ok(rollupsBefore > 0, "rollup row exists before retention");

    // 20 days later: the raw row is past the 14-day window, the rollup is not.
    clockMs += 20 * 24 * 3600_000;
    obs.maintenancePass();

    assert.equal(obs.store.timeline("packs-p1-deployments-a1", { limit: 100 }).length, 0, "raw row expired");
    assert.equal(obs.store.rollupRows([key]).length, rollupsBefore, "rollup rows survive retention");
    const snap = obs.retentionSnapshot();
    assert.equal(snap.state, "ok");
    assert.equal(snap.retained_at, clockMs, "the pass records when it ran");
    assert.ok(snap.retained_rows >= 1, `retained_rows=${snap.retained_rows}`);
  } finally {
    obs.close(); srv.close(); clockMs = 1_800_001_234_567;
  }
});

test("maintenance: a retention policy that never ran is distinguishable from one that found nothing", async () => {
  const { obs, srv, base } = await harness();
  try {
    // Fresh observer, timer has not fired yet: "never", NOT "ok with 0 rows".
    assert.equal(obs.retentionSnapshot().state, "never");
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200, "readiness must not fail on a retention problem");
    assert.equal((await res.json()).retention.state, "never");

    obs.maintenancePass();
    const ok = obs.retentionSnapshot();
    assert.equal(ok.state, "ok");
    assert.equal(ok.error, null);

    // A wedged DELETE must not look like a healthy empty window.
    const realRetain = obs.store.retain;
    obs.store.retain = () => { throw new Error("disk full"); };
    obs.maintenancePass();
    const failing = obs.retentionSnapshot();
    assert.equal(failing.state, "failing");
    assert.match(String(failing.error), /disk full/);
    assert.equal((await (await fetch(`${base}/healthz`)).json()).retention.state, "failing");
    obs.store.retain = realRetain;
  } finally {
    obs.close(); srv.close();
  }
});

test("maintenance: a stale pass is reported as stale, not ok", async () => {
  const { obs, srv } = await harness();
  try {
    obs.maintenancePass();
    assert.equal(obs.retentionSnapshot().state, "ok");
    // The timer owns the beat; if it stops (or the process is wedged), the
    // snapshot must say so instead of repeating the last success forever.
    clockMs += 5 * 60_000; // five 60s intervals later
    assert.equal(obs.retentionSnapshot().state, "stale");
  } finally {
    obs.close(); srv.close(); clockMs = 1_800_001_234_567;
  }
});
