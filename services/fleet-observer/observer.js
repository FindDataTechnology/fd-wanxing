// ── fleet-observer app (add-fleet-event-backbone) ────────────────────────────
//
// The Wanxing plane's observability service: the /ingest batch endpoint
// (service credential, ULID-idempotent), the hour×agent rollup scheduler,
// retention cleanup, the bookkeeping synthesizer, and the observation API
// (/api/fleet/v1/board, /api/fleet/v1/agents/:slug/timeline). Rollups are the
// only query face for aggregates; raw rows serve the last-24h synthesis and
// timelines only.

import express from "express";
import { createEventStore, EVENT_KINDS } from "./store.js";
import { createBookkeeper } from "./bookkeeper.js";
import { ulid } from "./ulid.js";

const hourKeyOf = (tsMs) => new Date(tsMs).toISOString().slice(0, 13) + ":00";

export function createObserver({
  dataRoot,
  ingestToken,
  now = Date.now,
  fetchImpl = null,
  registryUrl = "",
  registryToken = "",
  pollIntervalMs = 30_000,
  rollupIntervalMs = 60_000,
  retentionMs = 14 * 24 * 3600_000,
  log = null,
}) {
  const store = createEventStore({ file: `${dataRoot}/fleet-events.db` });
  const say = log ?? (() => {});
  const requireToken = (req, res) => {
    if (!ingestToken || req.headers.authorization !== `Bearer ${ingestToken}`) {
      res.status(401).json({ error: "fleet service credential required" });
      return false;
    }
    return true;
  };

  // Synthesized bookkeeping events enter through the same store, with
  // deterministic ids (stable per detection) so a retried synthesis can never
  // double-count.
  const bookEmit = (ev) => {
    store.insertMany([{ ...ev, id: ulid(), source: "bookkeeper", ingested_at: now() }], now());
  };
  const bookkeeper = registryUrl
    ? createBookkeeper({ registryUrl, token: registryToken, fetchImpl, now, emit: bookEmit, log: say, intervalMs: pollIntervalMs })
    : null;

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.post("/ingest", (req, res) => {
    if (!requireToken(req, res)) return;
    const events = req.body?.events;
    if (!Array.isArray(events) || events.length === 0 || events.length > 5000) {
      return res.status(400).json({ error: "events must be a non-empty array (≤5000)" });
    }
    for (const e of events) {
      if (!e || typeof e.id !== "string" || !e.id || typeof e.source !== "string" || !e.source ||
          typeof e.agent !== "string" || !e.agent || !EVENT_KINDS.includes(e.kind) || !Number.isFinite(Number(e.ts))) {
        return res.status(400).json({ error: `invalid event: ${JSON.stringify(e)?.slice(0, 200)}` });
      }
    }
    const inserted = store.insertMany(events, now());
    res.json({ accepted: inserted, duplicates: events.length - inserted });
  });

  // ── Rollup pass: last 2 full hours + current hour (idempotent overwrite);
  // boot pass widens to 48h so a restart heals recent hours. Retention rides
  // along hourly.
  function rollupPass(bootWindowHours = 3) {
    const t = now();
    const hours = new Set([hourKeyOf(t), hourKeyOf(t - 3600_000), hourKeyOf(t - 2 * 3600_000)]);
    if (bootWindowHours > 3) {
      for (let i = 3; i < bootWindowHours; i++) hours.add(hourKeyOf(t - i * 3600_000));
    }
    let n = 0;
    for (const hk of hours) {
      const s = Date.parse(hk.slice(0, 13) + ":00:00Z");
      n += store.rollupHour(hk, s, s + 3600_000);
    }
    return { hours: hours.size, agents: n };
  }

  const rollupTimer = setInterval(() => {
    try { rollupPass(); } catch (e) { say(`rollup failed: ${e.message}`); }
    try { store.retain(now(), retentionMs); } catch { /* next pass */ }
  }, rollupIntervalMs);
  rollupTimer.unref?.();
  let booted = false;

  // ── Observation API ───────────────────────────────────────────────────────
  app.get("/api/fleet/v1/board", (_req, res) => {
    if (!requireToken(_req, res)) return;
    const t = now();
    const since24 = t - 24 * 3600_000;
    const since2h = t - 2 * 3600_000; // live-synthesis window (turn budgets cap turns ≪ 2h)

    // Counters come from the rollup face only (24 hour keys incl. current,
    // recomputed every pass — ≤1 rollup interval stale by design); the raw
    // stream serves bounded kind windows, never a full-day scan (a sustained
    // 1M/day full-window board read measured 24s — see bench-fleet-million).
    const hourKeys = [];
    for (let i = 0; i < 24; i++) hourKeys.push(hourKeyOf(t - i * 3600_000));
    if (!booted) { try { rollupPass(48); } catch {} booted = true; }
    const rows = store.rollupRows(hourKeys);
    const agg = { turns: 0, errors: 0, minutes_billed: 0, usd: 0, budget_kills: 0 };
    const agents = new Set();
    for (const r of rows) {
      agg.turns += r.turns; agg.errors += r.errors; agg.minutes_billed += r.minutes_billed;
      agg.usd += r.usd; agg.budget_kills += r.budget_kills;
      agents.add(r.agent);
    }

    // Live synthesis over bounded kind windows.
    const stateRows = store.kindSince(["state_changed"], since2h);
    const turnRows = store.kindSince(["turn_started", "turn_ended"], since2h);
    const states = {};
    const turnOpen = new Set();
    const wake = [];
    for (const e of turnRows) {
      if (e.kind === "turn_started") {
        turnOpen.add(e.agent);
        agents.add(e.agent);
        if (Number.isFinite(Number(e.payload?.wake_ms))) wake.push(Number(e.payload.wake_ms));
      } else turnOpen.delete(e.agent);
    }
    for (let i = stateRows.length - 1; i >= 0; i--) { // newest first → first seen = current
      const e = stateRows[i];
      agents.add(e.agent);
      if (!(e.agent in states)) states[e.agent] = e.payload?.to ?? null;
    }
    const settledRows = store.kindSince(["settled"], since24);
    const settledPending = { count: 0, usd: 0 };
    for (const e of settledRows) {
      if (e.payload?.settlement_status === "pending") { settledPending.count += 1; settledPending.usd += Number(e.payload?.usd) || 0; }
    }
    const reaped = store.kindSince(["reaped"], since24).length;
    const dist = { serving: 0, resident: 0, paused: 0, starting: 0, draining: 0, warm: 0, unknown: 0 };
    for (const a of agents) {
      let s = states[a];
      if (!s) s = turnOpen.has(a) ? "serving" : "unknown";
      else if (turnOpen.has(a)) s = "serving"; // a live turn outranks a stale sample
      dist[s in dist ? s : "unknown"] += 1;
    }
    const pct = (xs, q) => {
      if (!xs.length) return null;
      const s = xs.slice().sort((x, y) => x - y);
      return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))]);
    };
    // Per-runner stats: the freshest runner_stats per source (warm 水位).
    const statRows = store.kindSince(["runner_stats"], t - 30 * 60_000);
    const runnerStats = {};
    for (let i = statRows.length - 1; i >= 0; i--) {
      const e = statRows[i];
      if (e.runner && !runnerStats[e.runner]) runnerStats[e.runner] = { seen_at: e.ts, ...(e.payload ?? {}) };
    }
    res.json({
      window: "24h",
      states_window: "2h",
      agents_total: agents.size,
      states: dist,
      runners: runnerStats,
      turns: agg.turns,
      errors: agg.errors,
      minutes_billed: Number(agg.minutes_billed.toFixed(2)),
      usd: Number(agg.usd.toFixed(4)),
      budget_kills: agg.budget_kills,
      reaped,
      wake_ms: { p50: pct(wake, 0.5), p95: pct(wake, 0.95) },
      settled_pending: settledPending,
      ingest_lag: store.ingestLag(t), // arrival vs event-age bases kept apart
    });
  });

  app.get("/api/fleet/v1/agents/:slug/timeline", (req, res) => {
    if (!requireToken(req, res)) return;
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 1000);
    const since = Number.parseInt(String(req.query.since ?? "0"), 10) || 0;
    res.json({ agent: req.params.slug, events: store.timeline(req.params.slug, { since, limit }) });
  });

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  return {
    app,
    store,
    bookkeeper,
    rollupPass,
    // Schedulers are explicit: the bootstrap (index.js) starts them; tests
    // drive polls/passes by hand.
    start() { bookkeeper?.start(); },
    close() {
      if (rollupTimer) clearInterval(rollupTimer);
      bookkeeper?.stop();
      store.close();
    },
  };
}
