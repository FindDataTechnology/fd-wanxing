// ── fleet-observer app (add-fleet-event-backbone) ────────────────────────────
//
// The Wanxing plane's observability service: the /ingest batch endpoint
// (service credential, ULID-idempotent), the hour×agent rollup scheduler,
// retention cleanup, the bookkeeping synthesizer, and the observation API
// (/api/fleet/v1/board, /api/fleet/v1/agents/:slug/timeline). Rollups are the
// only query face for aggregates; raw rows serve the last-24h synthesis and
// timelines only.

import express from "express";
import { createEventStore, EVENT_KINDS, MISSION_EVENT_KINDS } from "./store.js";
import { createBookkeeper } from "./bookkeeper.js";
import { createStatsStore, packOfAgent } from "./stats-store.js";
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
  // Stats plane (add-stats-plane-v1): sister DB, optional sub2api pull, and an
  // env-provisioned collector token (hash lands in stats.db at boot; rotating
  // the env + rolling re-provisions).
  stats = null,
  sub2api = null,
  collectorToken = "",
}) {
  const store = createEventStore({ file: `${dataRoot}/fleet-events.db` });
  const say = log ?? (() => {});
  const statsStore = stats
    ? stats
    : createStatsStore({ file: `${dataRoot}/stats.db` });
  if (collectorToken) {
    try { statsStore.provisionCollectorToken(collectorToken, "env-provisioned"); } catch { /* already present */ }
  }
  let statsGaps = 0;
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
    // Stats double-write (add-stats-plane-v1 D2): observation stays the SLA;
    // a stats failure counts a gap and never blocks the ingest response.
    try {
      const usageRows = [];
      for (const e of events) {
        if (e.kind !== "turn_ended" || !Number.isFinite(Number(e.payload?.tokens))) continue;
        usageRows.push({
          id: `evt:${e.id}`,
          ts: Number(e.ts),
          agent: e.agent,
          pack: packOfAgent(e.agent),
          model: "",
          session: e.payload?.session ?? null,
          harness: null,
          source: "fleet",
          basis: "estimated",
          turn_kind: e.payload?.turn_kind ?? null,
          outcome: e.payload?.outcome ?? null,
          tokens_in: 0,
          tokens_out: Number(e.payload.tokens) || 0,
          cache_read: 0,
          cache_write: 0,
          duration_ms: Number.isFinite(Number(e.payload?.duration_ms)) ? Number(e.payload.duration_ms) : null,
        });
      }
      if (usageRows.length) statsStore.recordUsage(usageRows);
    } catch (e) {
      statsGaps += 1;
      say(`stats write gap #${statsGaps}: ${e.message}`);
    }
    res.json({ accepted: inserted, duplicates: events.length - inserted });
  });

  // ── Local collector ingest: fsc_ token, stats-only (never touches the
  // observation kind set). Events carry harness usage blocks, basis=estimated.
  app.post("/ingest/local", (req, res) => {
    const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!statsStore.verifyCollectorToken(token)) {
      return res.status(401).json({ error: "collector token required" });
    }
    const events = req.body?.events;
    if (!Array.isArray(events) || events.length === 0 || events.length > 5000) {
      return res.status(400).json({ error: "events must be a non-empty array (≤5000)" });
    }
    const rows = [];
    let skipped = 0;
    for (const e of events) {
      if (!e || !Number.isFinite(Number(e.ts)) || !Number.isFinite(Number(e.tokens_out ?? e.tokens_in))) { skipped += 1; continue; }
      rows.push({
        id: String(e.id ?? `loc:${e.ts}:${e.session ?? ""}:${rows.length}`),
        ts: Number(e.ts),
        agent: `local:${e.harness ?? "unknown"}`,
        pack: "local",
        model: String(e.model ?? ""),
        session: e.session ?? null,
        harness: String(e.harness ?? "unknown"),
        source: "local",
        basis: "estimated",
        turn_kind: e.turn_kind ?? null,
        outcome: e.outcome ?? null,
        tokens_in: Number(e.tokens_in) || 0,
        tokens_out: Number(e.tokens_out) || 0,
        cache_read: Number(e.cache_read) || 0,
        cache_write: Number(e.cache_write) || 0,
        duration_ms: Number.isFinite(Number(e.duration_ms)) ? Number(e.duration_ms) : null,
      });
    }
    let stored = 0;
    try { stored = statsStore.recordUsage(rows); } catch (e) { return res.status(500).json({ error: "stats store failed" }); }
    res.json({ stored, skipped });
  });

  // ── Stats API (add-stats-plane-v1): every figure carries (source, basis);
  // the server never merges calibers into one number.
  const statsSince = (req) => {
    const days = Math.min(Math.max(Number.parseInt(String(req.query.days ?? "7"), 10) || 7, 1), 400);
    return now() - days * 86_400_000;
  };
  app.get("/api/fleet/v1/stats/overview", (req, res) => {
    if (!requireToken(req, res)) return;
    res.json({ since: statsSince(req), ...statsStore.overview(statsSince(req)) });
  });
  app.get("/api/fleet/v1/stats/by-agent", (req, res) => {
    if (!requireToken(req, res)) return;
    res.json({ since: statsSince(req), source_basis_rule: "figures never merged across calibers", rows: statsStore.grouped(statsSince(req), "agent") });
  });
  app.get("/api/fleet/v1/stats/by-model", (req, res) => {
    if (!requireToken(req, res)) return;
    res.json({ since: statsSince(req), rows: statsStore.grouped(statsSince(req), "model") });
  });
  app.get("/api/fleet/v1/stats/daily", (req, res) => {
    if (!requireToken(req, res)) return;
    res.json({
      since: statsSince(req),
      fleet: statsStore.daily(statsSince(req)),
      sub2api: { basis: "billed", rows: statsStore.sub2apiDaily(statsSince(req)) },
    });
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
    // Stats hygiene rides along: daily rollup for yesterday+today + detail prune.
    try {
      const dayNow = new Date(now()).toISOString().slice(0, 10);
      statsStore.rollupDay(dayNow);
      statsStore.rollupDay(new Date(now() - 86_400_000).toISOString().slice(0, 10));
      statsStore.pruneDetail(now());
    } catch (e) { say(`stats rollup failed: ${e.message}`); }
  }, rollupIntervalMs);
  rollupTimer.unref?.();

  // ── sub2api pull (add-stats-plane-v1 D3): hourly, read-only admin API,
  // billed caliber only. Failure = stale flag, never a block.
  const sub2apiPull = async () => {
    if (!sub2api?.baseUrl || !sub2api?.token) return;
    const fetchFn = fetchImpl ?? fetch;
    const days = 2; // re-pull the sliding window (idempotent upsert)
    // The endpoint is one row PER REQUEST, and the writer upserts on
    // (day, bucket, kind) with a plain SET — so rows must be aggregated here
    // before writing, or each bucket would keep only its last request.
    const agg = new Map();
    let seen = 0;
    for (let i = 0; i < days; i++) {
      const day = new Date(now() - i * 86_400_000).toISOString().slice(0, 10);
      let page = 1;
      // Measured 2026-10-19: this endpoint reports `total`/`pages` RELATIVE to
      // the requested page (page 1 → total 201, page 2 → 401, page 3 → 601), so
      // neither field is a real total. The only sound stop condition is an
      // empty/short page; MAX_PAGES is a safety valve, not the window.
      const PAGE_SIZE = 200;
      // Measured 2026-10-19: production runs ~119k requests/day = 597 pages at
      // this page size, and the volume keeps growing. The cap is a safety valve
      // against a malformed `items` loop, not the expected window — a full
      // 2-day sweep is ~1.2k requests (~3 min) once an hour, which the local
      // admin API absorbs comfortably.
      const MAX_PAGES = 2000; // 400k requests/day ceiling
      for (; page <= MAX_PAGES; page++) {
        const url = `${sub2api.baseUrl.replace(/\/+$/, "")}/api/v1/admin/usage?start=${day}&end=${day}&page=${page}&page_size=${PAGE_SIZE}`;
        let resp;
        try {
          // sub2api authenticates /api/v1/admin/* with x-api-key (not Bearer) —
          // see wanxing-facade/lib/sub2api-admin.js; Bearer returns 401 INVALID_TOKEN.
          resp = await fetchFn(url, { headers: { "x-api-key": sub2api.token } });
        } catch (e) {
          say(`sub2api pull failed (${day}): ${e.message}`); return;
        }
        if (!resp.ok) { say(`sub2api pull ${resp.status} (${day}) — staying stale`); return; }
        let body;
        try { body = await resp.json(); } catch { say(`sub2api pull bad json (${day})`); return; }
        if (body && typeof body.code === "number" && body.code !== 0) {
          say(`sub2api pull code ${body.code} (${day}): ${body.message ?? ""} — staying stale`); return;
        }
        const items = Array.isArray(body?.data) ? body.data : Array.isArray(body?.data?.items) ? body.data.items : Array.isArray(body?.items) ? body.items : null;
        if (!items) { say(`sub2api pull unknown shape (${day}) — mapper needs a look`); return; }
        seen += items.length;
        for (const it of items) {
          const r = mapSub2apiRow(it, day);
          const k = `${r.day}|${r.bucket}|${r.kind}`;
          const prev = agg.get(k);
          if (!prev) { agg.set(k, { ...r }); continue; }
          prev.tokens_in += r.tokens_in;
          prev.tokens_out += r.tokens_out;
          prev.requests += r.requests;
          const c = Number(r.cost);
          if (Number.isFinite(c)) prev.cost = String((Number(prev.cost) || 0) + c);
        }
        if (items.length < PAGE_SIZE) break; // last page
      }
      if (page > MAX_PAGES) say(`sub2api pull hit the ${MAX_PAGES}-page ceiling (${day}) — daily volume exceeded the window`);
      else say(`sub2api pull ${day}: ${page - 1} page(s)`);
    }
    const rows = [...agg.values()];
    if (rows.length) { statsStore.recordSub2apiDay(rows, now()); say(`sub2api pull ok: ${rows.length} bucket(s), ${seen} request row(s)`); }
  };
  const sub2apiTimer = setInterval(() => { sub2apiPull().catch((e) => say(`sub2api pull error: ${e.message}`)); }, 3600_000);
  sub2apiTimer.unref?.();
  // Pull once at boot: an hourly-only schedule leaves the billed caliber empty
  // for up to an hour after every rollover (observed 2026-10-19).
  const bootPull = setTimeout(() => { sub2apiPull().catch((e) => say(`sub2api pull error: ${e.message}`)); }, 5_000);
  bootPull.unref?.();
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

    // Mission overview (add-mission-board): synthesized from the bounded raw
    // window — mission events are rare (one per transition), so the rollup
    // face is the wrong home; 24h raw is both bounded and complete here.
    const missionRows = store.kindSince(MISSION_EVENT_KINDS, since24);
    // Equal-ts rows come back in index order, not arrival order — rank every
    // event by (ts, lifecycle position) so current status and trail order are
    // robust to the storage order, not just the common distinct-ts case.
    const LIFECYCLE = ["submitted", "planning", "awaiting_approval", "auto_approved", "scheduled", "executing", "reported", "failed", "aborted"];
    const rank = (k) => LIFECYCLE.indexOf(k) >= 0 ? LIFECYCLE.indexOf(k) : LIFECYCLE.length;
    const missionsById = new Map();
    for (const e of missionRows) {
      const id = e.payload?.mission;
      if (!id) continue;
      const to = e.kind.slice("mission.".length);
      let m = missionsById.get(id);
      if (!m) { m = { id, owner: e.payload?.owner ?? null, status: null, trail: [], spent: null, at: e.ts, _rank: -1 }; missionsById.set(id, m); }
      if (!m.trail.includes(to)) m.trail.push(to);
      const r = rank(to);
      if (e.ts > m.at || (e.ts === m.at && r >= m._rank)) { m.status = to; m.at = e.ts; m._rank = r; }
      if (Number.isFinite(Number(e.payload?.spent))) m.spent = Number(e.payload.spent);
    }
    const missions = [...missionsById.values()]
      .map(({ _rank, ...m }) => ({ ...m, trail: m.trail.slice().sort((x, y) => rank(x) - rank(y)) }))
      .sort((a, b) => b.at - a.at).slice(0, 100);
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
    // Cell short-term telemetry (add-fleet-cell-views): freshest cell_stats per
    // cell identity in the same 30-min window — snapshots, not an event stream,
    // so "latest wins" is the whole aggregation. Deliberately NOT fed into the
    // agents/states scopes above: those count resident serving agents only, and
    // cell identities polluting them would blur the resident picture.
    const cellRows = store.kindSince(["cell_stats"], t - 30 * 60_000);
    const cells = {};
    const shortterm = { cells: 0, running: 0, queued: 0, workers_busy: 0, workers_idle: 0, workers_cap: 0 };
    for (let i = cellRows.length - 1; i >= 0; i--) {
      const e = cellRows[i];
      if (!e.agent || cells[e.agent]) continue;
      cells[e.agent] = { seen_at: e.ts, ...(e.payload ?? {}) };
      shortterm.cells += 1;
      shortterm.running += Number(e.payload?.executions?.running) || 0;
      shortterm.queued += Number(e.payload?.executions?.queued) || 0;
      shortterm.workers_busy += Number(e.payload?.workers?.busy) || 0;
      shortterm.workers_idle += Number(e.payload?.workers?.idle) || 0;
      shortterm.workers_cap += Number(e.payload?.workers?.cap) || 0;
    }
    res.json({
      window: "24h",
      states_window: "2h",
      agents_total: agents.size,
      states: dist,
      runners: runnerStats,
      cells,
      shortterm,
      turns: agg.turns,
      errors: agg.errors,
      minutes_billed: Number(agg.minutes_billed.toFixed(2)),
      usd: Number(agg.usd.toFixed(4)),
      budget_kills: agg.budget_kills,
      reaped,
      wake_ms: { p50: pct(wake, 0.5), p95: pct(wake, 0.95) },
      settled_pending: settledPending,
      missions,
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
    statsStore,
    bookkeeper,
    rollupPass,
    sub2apiPull,
    // Schedulers are explicit: the bootstrap (index.js) starts them; tests
    // drive polls/passes by hand.
    start() { bookkeeper?.start(); },
    close() {
      if (rollupTimer) clearInterval(rollupTimer);
      if (sub2apiTimer) clearInterval(sub2apiTimer);
      if (bootPull) clearTimeout(bootPull);
      bookkeeper?.stop();
      store.close();
      statsStore.close();
    },
  };
}


// Tolerant row mapper for the sub2api admin usage endpoint. Field names vary
// across shapes; unknown-but-200 shapes are logged upstream and skipped here.
// Bucketed by api_key_id (stable billing identity) with the model appended, so
// a day's rows stay attributable; per-request rows collapse via the PK upsert.
// Cost is sub2api's own `total_cost` (billed caliber) — never recomputed here.
function mapSub2apiRow(it, day) {
  const key = it.api_key_id ?? it.key ?? it.key_label ?? it.user_id ?? "";
  const model = it.model ? String(it.model) : "";
  return {
    day,
    bucket: model ? `${key}:${model}` : String(key),
    kind: String(it.kind ?? "usage"),
    tokens_in: Number(it.input_tokens ?? it.prompt_tokens ?? it.tokens_in) || 0,
    tokens_out: Number(it.output_tokens ?? it.completion_tokens ?? it.tokens_out) || 0,
    // The admin usage endpoint is one row per request; there is no request
    // counter field, so each row contributes 1 (summed by the upsert below is
    // a plain set — the caller aggregates before writing).
    requests: Number(it.requests ?? it.count ?? it.call_count ?? 1) || 0,
    cost: it.total_cost ?? it.actual_cost ?? it.cost ?? it.amount ?? it.quota ?? null,
    currency: it.currency ?? (it.total_cost != null || it.actual_cost != null || it.cost != null || it.amount != null ? "USD" : null),
  };
}
