#!/usr/bin/env node
// ── Board health section + edge events (surface-silent-agent-failures 2.1–2.3) ─
//
// Two things are being locked here:
//   1. the board gains `agent_health` WITHOUT touching a single existing field
//      (multiple consumers read this response);
//   2. transitions emit exactly one event each, deduped on `since`, and the two
//      new kinds are in the ingest allowlist — without that the observer's own
//      events would be rejected 400 (observer.js:74).
//
//   node --test scripts/test-fleet-health-board.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { test } from "node:test";

const { createObserver } = await import("../services/fleet-observer/observer.js");
const { EVENT_KINDS } = await import("../services/fleet-observer/store.js");

const tmp = mkdtempSync(path.join(tmpdir(), "wx-health-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const TOKEN = "obs-test-token";
const HOUR = 3_600_000;

// createObserver returns { app, store, rollupPass, start, close, … }.
async function harness() {
  const dataRoot = mkdtempSync(path.join(tmp, "h-"));
  const clock = { value: Date.parse("2026-11-10T03:00:00Z") };
  const observer = createObserver({ dataRoot, ingestToken: TOKEN, now: () => clock.value, log: () => {} });
  // The observer runs rollup and health on its own timer; tests drive both by
  // hand so the assertions do not depend on a wall clock or a live interval.
  const tick = () => { observer.rollupPass(); observer.evaluateHealth(); };
  const server = http.createServer(observer.app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, init = {}) =>
    fetch(base + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) } })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { clock, base, call, tick, close: () => new Promise((r) => server.close(r)) };
}

const BASE = Date.parse("2026-11-10T03:00:00Z");
const turnAt = (agent, tsMs, { ok }) => ({
  events: [{
    id: `e-${agent}-${tsMs}-${Math.random().toString(36).slice(2)}`,
    source: "runner", agent, kind: "turn_ended", ts: tsMs,
    payload: { outcome: ok ? "ok" : "error" },
  }],
});
// hoursAgo: how many hourly buckets back from BASE the turn belongs to.
const turn = (agent, hoursAgo, opts) => turnAt(agent, BASE - hoursAgo * HOUR, opts);

// ── 2.3 the new kinds must be ingestible ────────────────────────────────────

test("2.3 agent_unhealthy / agent_healthy are in the ingest allowlist", () => {
  assert.ok(EVENT_KINDS.includes("agent_unhealthy"));
  assert.ok(EVENT_KINDS.includes("agent_healthy"));
});

// ── 2.1 board carries agent_health without disturbing existing fields ───────

test("2.1 board exposes agent_health and leaves the existing shape untouched", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/ingest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ events: [
        ...turn("bad", 1, { ok: false }).events,
        ...turn("bad", 2, { ok: false }).events,
        ...turn("bad", 3, { ok: false }).events,
        ...turn("good", 1, { ok: true }).events,
      ] }),
    });
    h.tick();
    const board = await h.call("/api/fleet/v1/board");
    assert.equal(board.status, 200);

    // existing contract intact
    for (const k of ["window", "agents_total", "states", "turns", "errors", "minutes_billed", "usd", "missions", "ingest_lag"]) {
      assert.ok(k in board.body, `missing pre-existing field ${k}`);
    }
    assert.equal(board.body.window, "24h");

    // new section
    assert.ok(Array.isArray(board.body.agent_health));
    const bad = board.body.agent_health.find((x) => x.agent === "bad");
    const good = board.body.agent_health.find((x) => x.agent === "good");
    assert.equal(bad.health, "failing");
    assert.equal(bad.window_hours, 24);
    assert.equal(good.health, "ok");
    assert.equal(board.body.agent_health[0].agent, "bad", "failing sorts first");
  } finally {
    await h.close();
  }
});

// ── infrastructure identities are not agents ────────────────────────────────

test("2.1 cell:* identities never appear in agent_health", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/ingest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ events: [
        // A cell snapshot rides the same ingest and creates a rollup row with
        // zero turns — it is infrastructure, not an agent with no traffic.
        { id: "c1", source: "sampler", agent: "cell:1da519d4c1c0bf89", kind: "cell_fleets", ts: BASE - HOUR, payload: { v: 1 } },
        ...turn("real", 1, { ok: true }).events,
      ] }),
    });
    h.tick();
    const board = await h.call("/api/fleet/v1/board");
    const agents = (board.body.agent_health ?? []).map((x) => x.agent);
    assert.ok(!agents.some((a) => a.startsWith("cell:")), `cell identity leaked: ${JSON.stringify(agents)}`);
    assert.ok(agents.includes("real"));
  } finally {
    await h.close();
  }
});

// ── 2.2 edge events: one per transition, deduped on since ──────────────────

test("2.2 a transition emits one agent_unhealthy, repeats emit nothing, recovery pairs", async () => {
  const h = await harness();
  try {
    const post = (events) => fetch(`${h.base}/ingest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    });
    for (const off of [1, 2, 3]) await post(turn("flaky", off, { ok: false }).events);

    h.tick();
    await h.call("/api/fleet/v1/board");
    h.tick();
    await h.call("/api/fleet/v1/board"); // second pass, same since ⇒ must not re-emit

    const tl = await h.call("/api/fleet/v1/agents/flaky/timeline");
    const kinds = (tl.body.events ?? []).map((e) => e.kind).filter((k) => k.startsWith("agent_"));
    assert.deepEqual(kinds, ["agent_unhealthy"], `expected exactly one edge event, got ${JSON.stringify(kinds)}`);

    // Recovery is discovered at hourly-bucket granularity: the rollup is
    // progress-driven and never rewrites a committed hour, so the healthy turn
    // must land in a NEW bucket (one hour later) — exactly how production
    // behaves, and why recovery can lag by up to an hour.
    h.clock.value += HOUR;
    await post(turnAt("flaky", h.clock.value, { ok: true }).events);
    h.tick();
    await h.call("/api/fleet/v1/board");

    const tl2 = await h.call("/api/fleet/v1/agents/flaky/timeline");
    const kinds2 = (tl2.body.events ?? []).map((e) => e.kind).filter((k) => k.startsWith("agent_"));
    assert.ok(kinds2.includes("agent_healthy"), `expected a recovery event, got ${JSON.stringify(kinds2)}`);
  } finally {
    await h.close();
  }
});
