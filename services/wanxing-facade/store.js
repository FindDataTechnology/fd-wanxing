// ── Wanxing facade persistence (add-wanxing-serving-api) ─────────────────────
//
// The facade's own SQLite file at the gateway data root (the same
// per-concern isolation rule as packs.db / share-tokens.db): the external
// usage ledger (v1's authoritative record for external turns — ADR-0014
// boundary settlement), the idempotency replay window, the per-agent caller
// allowlist, and the caller debt-suspension state. No key material is ever
// stored — callers' sub2api keys live in sub2api, the facade only caches
// probe verdicts in memory (see core.js).

import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function createWanxingStore({ file }) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");

  // Private-agent caller allowlist: sub2api user ids per agent slug. The
  // deployer manages membership on the pack deploy surface; admission checks
  // membership for private agents only (public agents admit any solvent key).
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_agent_callers (
    agent_slug TEXT NOT NULL,
    sub2api_user_id INTEGER NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL,
    PRIMARY KEY (agent_slug, sub2api_user_id)
  )`);

  // Idempotency-Key replay window (scoped caller+agent+key): one row per
  // deduplicated message/send; `response` is the exact JSON-RPC doc replayed
  // verbatim. Rows age out of the window lazily on read.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_requests (
    caller_id INTEGER NOT NULL,
    agent_slug TEXT NOT NULL,
    idem_key TEXT NOT NULL,
    state TEXT NOT NULL,
    response TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (caller_id, agent_slug, idem_key)
  )`);

  // The external usage ledger — v1's authoritative record (spec:
  // platform-billing "external turns settle against the caller's key"). `id`
  // doubles as the settlement Idempotency-Key, so a retried deduction can
  // only ever land once. outcome=error rows are recorded but waived (no
  // charge): the caller got nothing for a platform-side failure.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_usage (
    id TEXT PRIMARY KEY,
    caller_id INTEGER NOT NULL,
    caller_email TEXT NOT NULL DEFAULT '',
    agent_slug TEXT NOT NULL,
    idem_key TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    minutes_billed INTEGER NOT NULL,
    rate_usd REAL NOT NULL,
    settlement_status TEXT NOT NULL,
    settled_at INTEGER
  )`);
  // Chat-lane dimensions (add-agent-chat-lane D3): the lane a turn arrived
  // on (api | chat) and, for chat rows, who pays (subsidy | host) plus the
  // visitor's tenant subject — the per-visitor daily subsidy is derived from
  // these columns, never from a separate counter. API rows keep the defaults
  // (channel api, settler NULL = the caller themself).
  const usageCols = new Set(db.prepare(`PRAGMA table_info(wanxing_usage)`).all().map((c) => c.name));
  if (!usageCols.has("channel")) db.exec(`ALTER TABLE wanxing_usage ADD COLUMN channel TEXT NOT NULL DEFAULT 'api'`);
  if (!usageCols.has("settler")) db.exec(`ALTER TABLE wanxing_usage ADD COLUMN settler TEXT`);
  if (!usageCols.has("visitor_sub")) db.exec(`ALTER TABLE wanxing_usage ADD COLUMN visitor_sub TEXT`);
  // Serving-plan audit reference (add-serving-plans D5): which plan a
  // plan-settled row was recorded under. Derivation keys on caller identity
  // (settler='plan' AND caller_id), so this column is the audit trail, not
  // the aggregation key — a cap rewrite never strands historical rows.
  if (!usageCols.has("plan_ref")) db.exec(`ALTER TABLE wanxing_usage ADD COLUMN plan_ref TEXT`);

  // Host allowance (D6): one one-time minute cap per agent, set and adjusted
  // by that deployment's deployer (or ops). Used minutes derive from the
  // ledger (settler='host' rows for the agent) — this table is the cap only.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_host_allowance (
    agent_slug TEXT PRIMARY KEY,
    limit_minutes INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  // Serving plans (add-serving-plans D1): one active plan per caller — the
  // row IS the prepaid bundle (a minute cap; adjusting the cap is the top-up,
  // exactly the host-allowance shape, but caller-keyed). Plan-settled minutes
  // derive from the ledger, never a counter. plan_ref is minted once per
  // caller and stays stable across cap rewrites for the usage rows' audit.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_plans (
    user_id INTEGER PRIMARY KEY,
    plan_ref TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    limit_minutes INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  // Caller debt state: consecutive settlement failures; a non-null
  // suspended_reason refuses admission until the billing gate passes again.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_caller_state (
    user_id INTEGER PRIMARY KEY,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    suspended_reason TEXT,
    updated_at INTEGER NOT NULL
  )`);

  // Caller preferences (add-caller-preferences): per (caller, agent)
  // personalization — the turn-completion callback (URL + HMAC secret) and
  // the external-context reap window in minutes. The secret is stored RAW
  // because the facade must SIGN with it (the deployment_keys discipline:
  // platform-side store only, never echoed outward, never logged). NULL
  // column = the dimension follows the platform default; a row with both
  // NULL is deleted by prefsClear (no tombstones).
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_caller_prefs (
    user_id INTEGER NOT NULL,
    agent_slug TEXT NOT NULL,
    callback_url TEXT,
    callback_secret TEXT,
    reap_minutes INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, agent_slug)
  )`);

  const now = () => Date.now();

  return {
    close() {
      db.close();
    },

    // ── Allowlist ───────────────────────────────────────────────────────────
    allowlistHas(agentSlug, userId) {
      return Boolean(
        db.prepare(`SELECT 1 FROM wanxing_agent_callers WHERE agent_slug = ? AND sub2api_user_id = ?`).get(agentSlug, userId),
      );
    },
    allowlistList(agentSlug) {
      return db.prepare(`SELECT sub2api_user_id AS userId, email, added_at AS addedAt FROM wanxing_agent_callers WHERE agent_slug = ? ORDER BY added_at`).all(agentSlug);
    },
    allowlistAdd(agentSlug, userId, email) {
      db.prepare(`INSERT INTO wanxing_agent_callers (agent_slug, sub2api_user_id, email, added_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (agent_slug, sub2api_user_id) DO UPDATE SET email = excluded.email`).run(agentSlug, Number(userId), String(email || ""), now());
    },
    allowlistRemove(agentSlug, userId) {
      db.prepare(`DELETE FROM wanxing_agent_callers WHERE agent_slug = ? AND sub2api_user_id = ?`).run(agentSlug, Number(userId));
    },

    // ── Idempotency ─────────────────────────────────────────────────────────
    requestGet(callerId, agentSlug, idemKey) {
      return db.prepare(`SELECT * FROM wanxing_requests WHERE caller_id = ? AND agent_slug = ? AND idem_key = ?`).get(callerId, agentSlug, idemKey) ?? null;
    },
    requestStart(callerId, agentSlug, idemKey) {
      // Returns false when a row already exists (single-flight race loser).
      const res = db.prepare(`INSERT INTO wanxing_requests (caller_id, agent_slug, idem_key, state, created_at) VALUES (?, ?, ?, 'running', ?)
        ON CONFLICT DO NOTHING`).run(callerId, agentSlug, idemKey, now());
      return res.changes === 1;
    },
    requestFinish(callerId, agentSlug, idemKey, state, response) {
      db.prepare(`UPDATE wanxing_requests SET state = ?, response = ? WHERE caller_id = ? AND agent_slug = ? AND idem_key = ?`)
        .run(state, response == null ? null : String(response).slice(0, 256 * 1024), callerId, agentSlug, idemKey);
    },

    // ── Usage ledger ────────────────────────────────────────────────────────
    usageInsert(row) {
      db.prepare(`INSERT INTO wanxing_usage (id, caller_id, caller_email, agent_slug, idem_key, started_at, ended_at, duration_ms, outcome, minutes_billed, rate_usd, settlement_status, channel, settler, visitor_sub, plan_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.callerId, row.callerEmail || "", row.agentSlug, row.idemKey || "", row.startedAt, row.endedAt, row.durationMs, row.outcome, row.minutesBilled, row.rateUsd, row.settlementStatus, row.channel || "api", row.settler ?? null, row.visitorSub ?? null, row.planRef ?? null);
    },
    usageMarkSettled(id) {
      db.prepare(`UPDATE wanxing_usage SET settlement_status = 'settled', settled_at = ? WHERE id = ?`).run(now(), id);
    },
    usagePending() {
      return db.prepare(`SELECT * FROM wanxing_usage WHERE settlement_status = 'pending' ORDER BY started_at`).all();
    },
    // Chat-lane allowance derivation (D3): no counters, the ledger IS the
    // source. Subsidy per visitor per day window [fromMs, toMs); host usage
    // is all-time for the agent (the cap is one-time).
    chatSubsidyUsed(visitorSub, fromMs, toMs) {
      const r = db.prepare(`SELECT COALESCE(SUM(minutes_billed), 0) AS m FROM wanxing_usage
        WHERE channel = 'chat' AND settler = 'subsidy' AND visitor_sub = ? AND started_at >= ? AND started_at < ?`)
        .get(visitorSub, fromMs, toMs);
      return r.m;
    },
    hostAllowanceUsed(agentSlug) {
      const r = db.prepare(`SELECT COALESCE(SUM(minutes_billed), 0) AS m FROM wanxing_usage
        WHERE channel = 'chat' AND settler = 'host' AND agent_slug = ?`).get(agentSlug);
      return r.m;
    },
    // Owner-facing aggregates (D8): by caller × channel over the window.
    // caller_email carries the visitor's email on chat rows (masked at the
    // READ side for deployers, never at rest) and the key holder on api rows.
    usageByCaller(agentSlug, sinceMs) {
      return db.prepare(`SELECT channel, caller_email AS email, COUNT(*) AS turns, SUM(minutes_billed) AS minutes,
        MAX(ended_at) AS lastAt FROM wanxing_usage WHERE agent_slug = ? AND started_at >= ?
        GROUP BY channel, caller_email ORDER BY lastAt DESC`).all(agentSlug, sinceMs);
    },
    usageActivity(agentSlug, limit = 50) {
      return db.prepare(`SELECT started_at AS at, channel, outcome, minutes_billed AS minutes, caller_email AS email
        FROM wanxing_usage WHERE agent_slug = ? ORDER BY started_at DESC LIMIT ?`).all(agentSlug, Math.max(1, Math.min(Number(limit) || 50, 200)));
    },
    usageBoard() {
      const byCaller = db.prepare(`SELECT caller_id AS callerId, caller_email AS email, COUNT(*) AS turns, SUM(minutes_billed) AS minutes, SUM(CASE WHEN settlement_status != 'waived' THEN minutes_billed * rate_usd ELSE 0 END) AS usd,
        SUM(CASE WHEN settlement_status = 'pending' THEN 1 ELSE 0 END) AS pending FROM wanxing_usage GROUP BY caller_id ORDER BY usd DESC`).all();
      const byAgent = db.prepare(`SELECT agent_slug AS agent, COUNT(*) AS turns, SUM(minutes_billed) AS minutes, SUM(CASE WHEN settlement_status != 'waived' THEN minutes_billed * rate_usd ELSE 0 END) AS usd,
        SUM(CASE WHEN settlement_status = 'pending' THEN 1 ELSE 0 END) AS pending FROM wanxing_usage GROUP BY agent_slug ORDER BY usd DESC`).all();
      return { byCaller, byAgent };
    },

    // ── Host allowance (D6) ─────────────────────────────────────────────────
    hostAllowanceGet(agentSlug) {
      const r = db.prepare(`SELECT limit_minutes, updated_by, updated_at FROM wanxing_host_allowance WHERE agent_slug = ?`).get(agentSlug);
      return r ? { limitMinutes: r.limit_minutes, updatedBy: r.updated_by, updatedAt: r.updated_at } : null;
    },
    hostAllowanceSet(agentSlug, limitMinutes, updatedBy) {
      db.prepare(`INSERT INTO wanxing_host_allowance (agent_slug, limit_minutes, updated_by, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(agent_slug) DO UPDATE SET limit_minutes = excluded.limit_minutes, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(agentSlug, Number(limitMinutes), String(updatedBy || ""), now());
    },

    // ── Serving plans (add-serving-plans D1/D5) ─────────────────────────────
    planGet(userId) {
      const r = db.prepare(`SELECT plan_ref, email, limit_minutes, note, updated_by, created_at, updated_at FROM wanxing_plans WHERE user_id = ?`).get(Number(userId));
      return r ? { planRef: r.plan_ref, email: r.email, limitMinutes: r.limit_minutes, note: r.note, updatedBy: r.updated_by, createdAt: r.created_at, updatedAt: r.updated_at } : null;
    },
    // Upsert the caller's plan; the plan_ref is minted on first issue and
    // survives cap rewrites (usage rows keep pointing at the same reference).
    // email rides along for the ops list — a caller with no turns yet still
    // reads human.
    planSet(userId, limitMinutes, updatedBy, note = "", email = "") {
      const existing = db.prepare(`SELECT plan_ref FROM wanxing_plans WHERE user_id = ?`).get(Number(userId));
      const planRef = existing?.plan_ref ?? `wp_${randomBytes(6).toString("hex")}`;
      db.prepare(`INSERT INTO wanxing_plans (user_id, plan_ref, email, limit_minutes, note, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, limit_minutes = excluded.limit_minutes, note = excluded.note,
          updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .run(Number(userId), planRef, String(email || ""), Number(limitMinutes), String(note || ""), String(updatedBy || ""), now(), now());
      return this.planGet(userId);
    },
    planUsed(userId) {
      const r = db.prepare(`SELECT COALESCE(SUM(minutes_billed), 0) AS m FROM wanxing_usage
        WHERE settler = 'plan' AND caller_id = ?`).get(Number(userId));
      return r.m;
    },
    planList() {
      const rows = db.prepare(`SELECT p.user_id AS userId, p.plan_ref AS planRef, p.email, p.limit_minutes AS limitMinutes, p.note, p.updated_by AS updatedBy, p.updated_at AS updatedAt,
        COALESCE((SELECT SUM(minutes_billed) FROM wanxing_usage WHERE settler = 'plan' AND caller_id = p.user_id), 0) AS usedMinutes
        FROM wanxing_plans p ORDER BY p.updated_at DESC`).all();
      return rows.map((r) => ({ ...r, remainingMinutes: Math.max(0, r.limitMinutes - r.usedMinutes) }));
    },
    // Caller statement (add-serving-plans 4.1): plan minutes derive from the
    // ledger; legacy = API-lane rows the caller themself paid for by key
    // balance (settler NULL). Chat-lane visitor rows can never collide with a
    // sub2api caller id (visitor ids are hashed 48-bit, far outside sub2api's
    // small-integer space) but are excluded by the settler/channel guards
    // anyway.
    callerUsageSummary(userId) {
      const r = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN settler = 'plan' THEN minutes_billed ELSE 0 END), 0) AS planMinutes,
        COALESCE(SUM(CASE WHEN settler = 'plan' THEN 1 ELSE 0 END), 0) AS planTurns,
        COALESCE(SUM(CASE WHEN channel = 'api' AND settler IS NULL THEN minutes_billed ELSE 0 END), 0) AS legacyMinutes,
        COALESCE(SUM(CASE WHEN channel = 'api' AND settler IS NULL THEN 1 ELSE 0 END), 0) AS legacyTurns
        FROM wanxing_usage WHERE caller_id = ?`).get(Number(userId));
      return r;
    },

    // ── Caller debt state ───────────────────────────────────────────────────
    callerState(userId) {
      return db.prepare(`SELECT * FROM wanxing_caller_state WHERE user_id = ?`).get(Number(userId)) ?? null;
    },
    recordSettlementFailure(userId, reason) {
      db.prepare(`INSERT INTO wanxing_caller_state (user_id, consecutive_failures, suspended_reason, updated_at) VALUES (?, 1, NULL, ?)
        ON CONFLICT (user_id) DO UPDATE SET consecutive_failures = consecutive_failures + 1, updated_at = excluded.updated_at`)
        .run(Number(userId), now());
      return db.prepare(`SELECT consecutive_failures FROM wanxing_caller_state WHERE user_id = ?`).get(Number(userId)).consecutive_failures;
    },
    suspendCaller(userId, reason) {
      db.prepare(`INSERT INTO wanxing_caller_state (user_id, consecutive_failures, suspended_reason, updated_at) VALUES (?, 0, ?, ?)
        ON CONFLICT (user_id) DO UPDATE SET suspended_reason = excluded.suspended_reason, updated_at = excluded.updated_at`)
        .run(Number(userId), String(reason), now());
    },
    clearCaller(userId) {
      db.prepare(`UPDATE wanxing_caller_state SET consecutive_failures = 0, suspended_reason = NULL, updated_at = ? WHERE user_id = ?`).run(now(), Number(userId));
    },

    // ── Caller preferences ──────────────────────────────────────────────────
    prefsGet(userId, agentSlug) {
      return db.prepare(`SELECT callback_url AS callbackUrl, callback_secret AS callbackSecret, reap_minutes AS reapMinutes, updated_at AS updatedAt
        FROM wanxing_caller_prefs WHERE user_id = ? AND agent_slug = ?`).get(Number(userId), agentSlug) ?? null;
    },
    // Patch-style upsert: only the provided dimensions change (undefined =
    // keep, null = explicit clear). The row is deleted when nothing is left —
    // "no row" and "all-default row" mean the same thing.
    prefsSet(userId, agentSlug, { callbackUrl, callbackSecret, reapMinutes } = {}) {
      const cur = this.prefsGet(userId, agentSlug) ?? { callbackUrl: null, callbackSecret: null, reapMinutes: null };
      const next = {
        callbackUrl: callbackUrl === undefined ? cur.callbackUrl : callbackUrl,
        callbackSecret: callbackSecret === undefined ? cur.callbackSecret : callbackSecret,
        reapMinutes: reapMinutes === undefined ? cur.reapMinutes : reapMinutes,
      };
      if (next.callbackUrl == null && next.callbackSecret == null && next.reapMinutes == null) {
        db.prepare(`DELETE FROM wanxing_caller_prefs WHERE user_id = ? AND agent_slug = ?`).run(Number(userId), agentSlug);
        return null;
      }
      db.prepare(`INSERT INTO wanxing_caller_prefs (user_id, agent_slug, callback_url, callback_secret, reap_minutes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, agent_slug) DO UPDATE SET
          callback_url = excluded.callback_url, callback_secret = excluded.callback_secret,
          reap_minutes = excluded.reap_minutes, updated_at = excluded.updated_at`)
        .run(Number(userId), agentSlug, next.callbackUrl ?? null, next.callbackSecret ?? null, next.reapMinutes ?? null, now());
      return next;
    },
  };
}
