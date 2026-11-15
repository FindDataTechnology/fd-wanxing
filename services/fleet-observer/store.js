// ── Fleet event store (add-fleet-event-backbone 1.1) ─────────────────────────
//
// The append-only lifecycle event store: raw events (14-day retention) plus
// the hour×agent rollup that is the ONLY query face for boards. Per-concern
// SQLite at the Wanxing data root, same isolation rule as paas's wanxing.db.
// Idempotency = the id PK (ULIDs globally unique; facade rows use their
// deterministic usage-row ids) — INSERT OR IGNORE, counted.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

// ── Release order for new kinds (add-agent-led-multi-host-lease 0.4) ────────
//
// Adding a kind is a TWO-SIDED change and the order is not free:
//
//   1. deploy the observer (this whitelist) FIRST,
//   2. deploy the sender (facade / runner / gateway sampler) SECOND.
//
// The reverse order rejects every batch that carries the new kind with a 400
// (observer.js `POST /ingest`), so the sender's spool grows and can never
// drain until the observer catches up — measured 2026-11-10 as 340 stuck rows
// from a single unknown `minted`. Rejection is deliberate and stays: silently
// dropping an unknown kind would trade a loud, fixable failure for a quiet,
// unfixable one ("unobservable ≠ healthy").
//
// Two guards keep this honest: scripts/test-fleet-observer.mjs scans the facade
// sources for emitted kinds and fails when one is missing here, and the same
// file asserts that an unknown kind still rejects the WHOLE batch (so the
// failure mode stays the documented one, not a partial accept).
export const EVENT_KINDS = [
  "deployed", "undeployed", "paused", "resumed",
  "woken", "reaped", "budget_killed",
  "turn_started", "turn_ended", "settled",
  "admitted", "refused",
  "state_changed", "runner_stats",
  // Embed lane (add-embed-copilot-lane E1+E2) emitted `minted` from
  // wanxing-facade/chat.js:537 WITHOUT adding it here, and because ingest
  // rejects the whole batch on one unknown kind, every flush carrying a mint
  // returned 400 — the facade's spool then grew unbounded (measured
  // 2026-11-10: 340 rows stuck, 12 of them `minted`, log only ever said
  // "flush refused (400)" because the body was discarded). `ask_answered`
  // (chat.js:862) and `cluster` (cluster.js:470/479) were in the same gap,
  // just not yet present in that backlog window. scripts/test-fleet-observer.mjs
  // now scans the facade sources and fails if an emitted kind is missing here.
  "minted", "ask_answered", "cluster",
  // Mediated connector identity (paas add-served-agent-connector-access): the
  // chat face reports each turn whose scope→actor registration failed, so an
  // operator can see "the connector call would have been refused for the wrong
  // reason" instead of reading a 404 in a log nobody tails. Same class as the
  // `minted` gap above: an emitted-but-unaccepted kind rejects the WHOLE batch,
  // which is why the facade's source scan now fails the build instead of
  // letting the spool grow.
  "connector_identity_unregistered",
  // Mission lifecycle (add-mission-board): the facade's dispatch face emits
  // these on every state-machine transition — enumerated, not prefix-wild,
  // so the reject surface stays enumerable.
  "mission.submitted", "mission.planning", "mission.awaiting_approval", "mission.auto_approved",
  "mission.scheduled", "mission.executing", "mission.reported", "mission.failed",
  "mission.aborted", "mission.exhausted",
  // Cell short-term telemetry (add-fleet-cell-views, fed by paas's gateway
  // cell sampler): periodic snapshots, one per live cell per tick — pure
  // counts, addressed as cell:<userId>.
  "cell_stats",
  // Fleet cockpit projection (fed by the same paas gateway sampler's second
  // lane, add-fleet-cockpit-projection): per live cell per tick, one bounded
  // snapshot ({v:1,sampledAt,fleets:[...]}) of every fleet the cell owner
  // runs — health counts / open-decision tops / latest report lines, stored
  // verbatim; the observer never re-derives any of it.
  "cell_fleets",
  // Borrowed-boundary kinds the agent-runner emits (ADR-0005: the runner lives
  // in paas, so the facade-source scan below cannot see it). Measured
  // 2026-11-10 by cross-checking `#fleetEmit("…")` in
  // paas/agent-runner/manager.js against this list: THREE were missing, and
  // the oldest had been emitting since 2026-10-06 —
  //   workspace_quota_exceeded  2026-10-06 adb89aa04
  //   billing_unparked          2026-10-21 eccae8cff
  //   billing_parked            2026-11-10 44c198cfd
  // Each one refuses its WHOLE batch (same failure as the `minted` incident),
  // so the runner's spool could not drain whenever it emitted one. The drift
  // test at the bottom of scripts/test-fleet-observer.mjs now scans the sibling
  // paas checkout when present.
  "workspace_quota_exceeded", "billing_parked", "billing_unparked",
  // Work-lease lifecycle (add-agent-led-multi-host-lease Phase 4) — declared here
  // BEFORE any sender emits them, which is the release order this file documents
  // at the top: the observer must know a kind before a producer can send it, or
  // every batch carrying it is refused. Nothing emits these yet; `lease.expired`
  // is the one the specs require to be a visible fact (a silent drop and a
  // healthy quiet lease must not look alike).
  "lease.claimed", "lease.renewed", "lease.expired",
  // Agent health transitions (surface-silent-agent-failures 2.2): emitted by
  // THIS observer at most once per transition — never per failing turn, so a
  // 19-day outage is two rows, not thousands. Ingest rejects unknown kinds
  // with 400 (observer.js:74), so these must be enumerated in the same
  // release that starts emitting them.
  "agent_unhealthy", "agent_healthy",
];

// The mission family (add-mission-board): board synthesis keys off this set.
export const MISSION_EVENT_KINDS = EVENT_KINDS.filter((k) => k.startsWith("mission."));

// The ingest gate, named once. It lived inline in observer.js `POST /ingest`,
// which meant the only guard over it (test-fleet-observer's facade-source scan)
// could check that a kind is REGISTERED but never that the shape PASSES — and
// from 2026-11-06 to 2026-11-15 the facade's board-stat event shipped without
// `source` (it sent `runner`+`agent` instead). Ingest rejects the WHOLE batch on
// one bad event, so every batch that carried the stat was refused 400 and the
// stat itself never landed — the board had no `facade` `runner_stats` row at all
// (production, 2026-11-15), i.e. the facade's own droppedEvents/spoolRows
// counters were blind and nothing said so. Predicate first, senders second.
// Accepts numeric-string ts? No: the store requires @ts as a number, and the
// gate is the one place that decides — keep it strict and let senders comply.
export function isValidEventShape(e) {
  return Boolean(e) && typeof e === "object"
    && typeof e.id === "string" && Boolean(e.id)
    && typeof e.source === "string" && Boolean(e.source)
    && typeof e.agent === "string" && Boolean(e.agent)
    && EVENT_KINDS.includes(e.kind)
    && Number.isFinite(Number(e.ts));
}

export function createEventStore({ file }) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");

  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    agent TEXT NOT NULL,
    runner TEXT,
    kind TEXT NOT NULL,
    ts INTEGER NOT NULL,
    ingested_at INTEGER NOT NULL,
    trace_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}'
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_agent_ts ON events(agent, ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events(kind, ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)`);

  db.exec(`CREATE TABLE IF NOT EXISTS rollup_agent_hour (
    hour TEXT NOT NULL,
    agent TEXT NOT NULL,
    turns INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    minutes_billed REAL NOT NULL DEFAULT 0,
    usd REAL NOT NULL DEFAULT 0,
    wake_p50_ms INTEGER,
    wake_p95_ms INTEGER,
    budget_kills INTEGER NOT NULL DEFAULT 0,
    paused_minutes REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (hour, agent)
  )`);

  // Rollup progress (wanxing-storage-longevity 1.1): the last fully computed
  // hour bucket. Lives HERE (same db as rollup_agent_hour) so the progress
  // write rides the same transaction as the bucket rows it confirms — the
  // design's "stats.db" mention was a slip; the observed holes are in this
  // store's rollup face.
  db.exec(`CREATE TABLE IF NOT EXISTS kv_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  const insEvent = db.prepare(`INSERT OR IGNORE INTO events
    (id, source, agent, runner, kind, ts, ingested_at, trace_id, payload)
    VALUES (@id, @source, @agent, @runner, @kind, @ts, @ingested_at, @trace_id, @payload)`);

  const rowToEvent = (r) => ({
    id: r.id, source: r.source, agent: r.agent, runner: r.runner, kind: r.kind,
    ts: r.ts, ingested_at: r.ingested_at, trace_id: r.trace_id,
    payload: JSON.parse(r.payload || "{}"),
  });

  // Shared hourly accumulation (rollupHour / rollupHourCommit —
  // wanxing-storage-longevity 1.1): with a progress pair, the bucket rows AND
  // the progress advance land in one transaction; a killed catch-up pass
  // resumes from the last CONFIRMED bucket, and recomputes are idempotent
  // overwrites.
  const rollupHourImpl = (hourKey, windowStartMs, windowEndMs, progress) => {
    const rows = db.prepare(`SELECT agent, kind, ts, payload FROM events WHERE ts >= ? AND ts < ? ORDER BY ts`).all(windowStartMs, windowEndMs);
    const acc = new Map(); // agent → accumulators
    const wake = new Map(); // agent → [wake_ms…]
    const pausedAt = new Map(); // agent → open paused ts (hour-clamped)
    for (const r of rows) {
      // Cell snapshots (add-fleet-cell-views) never enter the rollup face:
      // they contribute to no metric, and registering their cell: identities
      // here would leak them into the board's resident agents_total.
      if (r.kind === "cell_stats") continue;
      const a = acc.get(r.agent) ?? { turns: 0, errors: 0, minutes: 0, usd: 0, kills: 0, pausedMs: 0 };
      const p = JSON.parse(r.payload || "{}");
      switch (r.kind) {
        case "turn_ended":
          a.turns += 1;
          if (p.outcome === "error") a.errors += 1;
          break;
        case "settled":
          a.minutes += Number(p.minutes_billed) || 0;
          a.usd += Number(p.usd) || 0;
          break;
        case "turn_started":
          if (Number.isFinite(Number(p.wake_ms))) {
            (wake.get(r.agent) ?? wake.set(r.agent, []).get(r.agent)).push(Number(p.wake_ms));
          }
          break;
        case "budget_killed": a.kills += 1; break;
        case "paused": pausedAt.set(r.agent, Math.max(r.ts, windowStartMs)); break;
        case "resumed": {
          const from = pausedAt.get(r.agent);
          if (from != null) {
            a.pausedMs += Math.min(r.ts, windowEndMs) - from;
            pausedAt.delete(r.agent);
          }
          break;
        }
        default: break;
      }
      acc.set(r.agent, a);
    }
    const pct = (xs) => {
      if (!xs || xs.length === 0) return null;
      const s = xs.slice().sort((x, y) => x - y);
      return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.5))]);
    };
    const pct95 = (xs) => {
      if (!xs || xs.length === 0) return null;
      const s = xs.slice().sort((x, y) => x - y);
      return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]);
    };
    const put = db.prepare(`INSERT OR REPLACE INTO rollup_agent_hour
      (hour, agent, turns, errors, minutes_billed, usd, wake_p50_ms, wake_p95_ms, budget_kills, paused_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const metaSet = progress
      ? db.prepare("INSERT INTO kv_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      : null;
    const tx = db.transaction(() => {
      for (const [agent, a] of acc) {
        put.run(hourKey, agent, a.turns, a.errors, a.minutes, a.usd,
          pct(wake.get(agent)), pct95(wake.get(agent)), a.kills, a.pausedMs / 60_000);
      }
      // Hours with prior rollup rows but no raw events left (retention
      // cleaned them, or the recompute window shifted) keep their values —
      // rollups are append-only truth, never recomputed from nothing.
      if (progress) metaSet.run(progress[0], progress[1]);
    });
    tx();
    return acc.size;
  };

  return {
    close() { db.close(); },

    // ── kv meta (rollup progress, wanxing-storage-longevity 1.1) ───────────
    metaGet(key) {
      const r = db.prepare("SELECT value FROM kv_meta WHERE key = ?").get(key);
      return r ? r.value : null;
    },
    metaSet(key, value) {
      db.prepare("INSERT INTO kv_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    },

    // Batch insert; returns how many rows landed (dupes silently ignored —
    // at-least-once upstream means id repeats are the norm, not the error).
    insertMany(events, ingestedAt) {
      const tx = db.transaction((rows) => {
        let n = 0;
        for (const e of rows) {
          const res = insEvent.run({
            id: String(e.id), source: String(e.source), agent: String(e.agent),
            runner: e.runner ? String(e.runner) : null, kind: String(e.kind),
            ts: Number(e.ts), ingested_at: Number(e.ingested_at ?? ingestedAt),
            trace_id: e.trace_id ? String(e.trace_id) : null,
            payload: JSON.stringify(e.payload ?? {}),
          });
          n += res.changes;
        }
        return n;
      });
      return tx(events);
    },

    // Raw rows in [since, now] — board synthesis and rollup input.
    rawSince(sinceMs, kinds = null) {
      const rows = kinds
        ? db.prepare(`SELECT * FROM events WHERE ts >= ? AND kind IN (${kinds.map(() => "?").join(",")}) ORDER BY ts`).all(sinceMs, ...kinds)
        : db.prepare(`SELECT * FROM events WHERE ts >= ? ORDER BY ts`).all(sinceMs);
      return rows.map(rowToEvent);
    },

    // Kind-indexed window (idx_events_kind_ts): the board's live-synthesis
    // queries ride this, never rawSince — at a sustained 1M events/day a
    // full raw window scan is seconds; kind windows are its bounded slices.
    kindSince(kinds, sinceMs) {
      const rows = db.prepare(`SELECT * FROM events WHERE kind IN (${kinds.map(() => "?").join(",")}) AND ts >= ? ORDER BY ts`).all(...kinds, sinceMs);
      return rows.map(rowToEvent);
    },

    // Per-runner last-seen, aggregated in SQL (add-agent-led-multi-host-lease
    // 2.x): the board must be able to say "this runner has been silent for N
    // minutes" instead of letting the key vanish from a 30-minute window and
    // calling that "offline". Grouping here (rather than scanning every
    // runner_stats row in JS) keeps a day-long lookback cheap: at a 30s beat
    // one runner writes 2,880 rows/day.
    runnerLastSeen({ sinceMs = 0, kind = "runner_stats" } = {}) {
      return db
        .prepare(
          `SELECT runner, MAX(ts) AS last_seen_at, COUNT(*) AS beats
             FROM events
            WHERE kind = ? AND runner IS NOT NULL AND runner != '' AND ts >= ?
            GROUP BY runner
            ORDER BY last_seen_at DESC`,
        )
        .all(kind, sinceMs);
    },

    timeline(agent, { since = 0, limit = 100 } = {}) {
      const rows = db.prepare(`SELECT * FROM events WHERE agent = ? AND ts >= ? ORDER BY ts DESC LIMIT ?`).all(agent, since, limit);
      return rows.map(rowToEvent);
    },

    // Retention: raw events older than the window go; rollups stay forever.
    retain(nowMs, retentionMs) {
      return db.prepare(`DELETE FROM events WHERE ts < ?`).run(nowMs - retentionMs).changes;
    },

    // ── Rollup (idempotent recompute per hour) ─────────────────────────────
    rollupHour(hourKey, windowStartMs, windowEndMs) {
      return rollupHourImpl(hourKey, windowStartMs, windowEndMs, null);
    },

    // rollupHour + progress advance in ONE transaction
    // (wanxing-storage-longevity 1.1): a killed pass resumes from the last
    // bucket it actually confirmed; re-running a computed bucket is an
    // idempotent overwrite. Same accumulation as rollupHour.
    rollupHourCommit(hourKey, windowStartMs, windowEndMs, progressKey, progressValue) {
      return rollupHourImpl(hourKey, windowStartMs, windowEndMs, [progressKey, progressValue]);
    },

    rollupRows(hourKeys) {
      if (!hourKeys.length) return [];
      return db.prepare(`SELECT * FROM rollup_agent_hour WHERE hour IN (${hourKeys.map(() => "?").join(",")})`).all(...hourKeys);
    },

    // ── Board helpers ───────────────────────────────────────────────────────
    ingestLag(nowMs, windowMs = 3_600_000) {
      const rows = db.prepare(`SELECT source, MAX(ts) AS max_ts, MAX(ingested_at) AS max_ing FROM events WHERE ts > ? GROUP BY source`).all(nowMs - windowMs);
      return rows.map((r) => ({
        source: r.source,
        event_age_ms: r.max_ts == null ? null : Math.max(0, nowMs - r.max_ts), // source-clock basis
        arrival_age_ms: r.max_ing == null ? null : Math.max(0, nowMs - r.max_ing), // observer-clock basis
      }));
    },
  };
}
