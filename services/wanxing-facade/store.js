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
  // Mission attribution (add-mission-definitions D4): the facade-lane turns a
  // mission dispatched (planner dispatch turns, later facade-run steps) ride
  // this column — the mission's spent minutes derive from the ledger over it,
  // never from a counter. Rows without a mission keep NULL.
  if (!usageCols.has("mission_id")) db.exec(`ALTER TABLE wanxing_usage ADD COLUMN mission_id TEXT`);

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

  // Missions (add-mission-definitions D1): the M2 scenario-A four-tuple as a
  // first-class row — owner (console identity's sub2api account), goal/model/
  // window/cap, the explicit lifecycle state, planner artifacts (plan steps,
  // final report), the in-row audit trail, and the CURRENT epoch writeback
  // token (superseded on the next dispatch, dead on terminal — see D3). Spent
  // minutes always DERIVE from the usage ledger over mission_id; nothing here
  // is a counter.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_missions (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL,
    owner_email TEXT NOT NULL DEFAULT '',
    goal TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    cost_cap_minutes INTEGER NOT NULL,
    approval TEXT NOT NULL DEFAULT 'human',
    status TEXT NOT NULL DEFAULT 'draft',
    plan_json TEXT,
    report_json TEXT,
    history_json TEXT NOT NULL DEFAULT '[]',
    dispatch_token TEXT,
    dispatch_token_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);

  // Mission writeback idempotency (D3): one row per accepted planner
  // writeback, keyed (mission, idem_key) — a replayed key returns the
  // recorded result verbatim and never advances the state machine twice.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_mission_writebacks (
    mission_id TEXT NOT NULL,
    idem_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (mission_id, idem_key)
  )`);

  // Deployer revenue share (add-deployer-revenue-share, ADR-0022): the
  // business-authoritative earnings ledger. One row per usage id (the PK is
  // the idempotency discipline — INSERT OR IGNORE makes inline settle and the
  // sweep race-safe), amount = revenue × (1 − commission) frozen at credit
  // time so later knob turns never rewrite history. No negative rows exist:
  // share is only produced alongside a successful deduction.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_deployer_earnings (
    usage_id TEXT PRIMARY KEY,
    deployer_user_id INTEGER NOT NULL,
    deployer_email TEXT NOT NULL DEFAULT '',
    agent_slug TEXT NOT NULL,
    revenue_usd REAL NOT NULL,
    amount_usd REAL NOT NULL,
    commission REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'settled', 'void')),
    created_at INTEGER NOT NULL,
    settled_at INTEGER
  )`);

  // Facade-meta key/value store: the share epoch (this code's first boot)
  // bounds the reconciliation backfill — rows settled before the epoch are
  // history the deployer had no expectation of, and are never backfilled.
  db.exec(`CREATE TABLE IF NOT EXISTS wanxing_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
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
      db.prepare(`INSERT INTO wanxing_usage (id, caller_id, caller_email, agent_slug, idem_key, started_at, ended_at, duration_ms, outcome, minutes_billed, rate_usd, settlement_status, channel, settler, visitor_sub, plan_ref, mission_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.id, row.callerId, row.callerEmail || "", row.agentSlug, row.idemKey || "", row.startedAt, row.endedAt, row.durationMs, row.outcome, row.minutesBilled, row.rateUsd, row.settlementStatus, row.channel || "api", row.settler ?? null, row.visitorSub ?? null, row.planRef ?? null, row.missionId ?? null);
    },
    usageMarkSettled(id) {
      db.prepare(`UPDATE wanxing_usage SET settlement_status = 'settled', settled_at = ? WHERE id = ?`).run(now(), id);
    },
    usagePending() {
      return db.prepare(`SELECT * FROM wanxing_usage WHERE settlement_status = 'pending' ORDER BY started_at`).all();
    },
    usageGet(id) {
      return db.prepare(`SELECT * FROM wanxing_usage WHERE id = ?`).get(String(id)) ?? null;
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

    // ── Missions (add-mission-definitions D1/D2/D3) ─────────────────────────
    // The store's own guard is defense in depth: the route validates first
    // (richer errors), but an invalid four-tuple must never land a row even
    // through direct store use.
    missionCreate({ ownerId, ownerEmail, goal, model, windowStart, windowEnd, costCapMinutes, approval }) {
      const ws = Number(windowStart), we = Number(windowEnd), cap = Number(costCapMinutes);
      if (typeof goal !== "string" || !goal.trim() || goal.length > 4000) throw new Error("goal must be a non-empty string of at most 4000 chars");
      if (model != null && (typeof model !== "string" || model.length > 200)) throw new Error("model must be a string of at most 200 chars");
      if (!Number.isInteger(ws) || !Number.isInteger(we) || we <= ws) throw new Error("window must be integer epoch ms with end after start");
      if (!Number.isInteger(cap) || cap < 1 || cap > 1_000_000) throw new Error("costCapMinutes must be an integer in [1, 1000000]");
      if (approval !== "human" && approval !== "auto") throw new Error("approval must be human or auto");
      const id = `msn_${randomBytes(12).toString("hex")}`;
      db.prepare(`INSERT INTO wanxing_missions (id, owner_id, owner_email, goal, model, window_start, window_end, cost_cap_minutes, approval, status, history_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
        .run(id, Number(ownerId), String(ownerEmail || ""), goal.trim(), String(model || ""), ws, we,
          cap, approval, "[]", now(), now());
      return this.missionGet(id);
    },
    missionGet(id) {
      const r = db.prepare(`SELECT * FROM wanxing_missions WHERE id = ?`).get(String(id || ""));
      if (!r) return null;
      return {
        id: r.id, ownerId: r.owner_id, ownerEmail: r.owner_email, goal: r.goal, model: r.model,
        windowStart: r.window_start, windowEnd: r.window_end, costCapMinutes: r.cost_cap_minutes,
        approval: r.approval, status: r.status,
        plan: r.plan_json ? JSON.parse(r.plan_json) : null,
        report: r.report_json ? JSON.parse(r.report_json) : null,
        history: JSON.parse(r.history_json || "[]"),
        dispatchToken: r.dispatch_token, dispatchTokenAt: r.dispatch_token_at,
        createdAt: r.created_at, updatedAt: r.updated_at,
      };
    },
    missionList({ ownerId = null } = {}) {
      const rows = ownerId == null
        ? db.prepare(`SELECT id FROM wanxing_missions ORDER BY updated_at DESC LIMIT 500`).all()
        : db.prepare(`SELECT id FROM wanxing_missions WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200`).all(Number(ownerId));
      return rows.map((r) => {
        const m = this.missionGet(r.id);
        return { ...m, spentMinutes: this.missionSpent(r.id), plan: undefined, report: undefined, history: undefined };
      });
    },
    // Spent minutes derive from the ledger (settled or not) — the same
    // discipline as plans/host-allowance: the row set IS the source.
    missionSpent(id) {
      const r = db.prepare(`SELECT COALESCE(SUM(minutes_billed), 0) AS m FROM wanxing_usage WHERE mission_id = ?`).get(String(id || ""));
      return r.m;
    },
    // Optimistic-concurrency status write (design D2): the UPDATE only lands
    // on the expected from-status — a racing writer loses as an illegal
    // transition, so there is exactly one state-write point in the system.
    // Artifact columns ride along via COALESCE (NULL = keep) so a transition
    // and its payload land atomically.
    missionTransition(id, fromStatus, toStatus, by, note = "", { planJson = null, reportJson = null, dispatchToken, dispatchTokenAt } = {}) {
      const cur = db.prepare(`SELECT history_json FROM wanxing_missions WHERE id = ?`).get(String(id || ""));
      if (!cur) return null;
      const history = JSON.parse(cur.history_json || "[]");
      history.push({ to: toStatus, by: String(by || ""), at: now(), ...(note ? { note: String(note).slice(0, 300) } : {}) });
      const res = db.prepare(`UPDATE wanxing_missions SET status = ?, history_json = ?, updated_at = ?,
        plan_json = COALESCE(?, plan_json), report_json = COALESCE(?, report_json),
        dispatch_token = COALESCE(?, dispatch_token), dispatch_token_at = COALESCE(?, dispatch_token_at)
        WHERE id = ? AND status = ?`)
        .run(toStatus, JSON.stringify(history), now(), planJson, reportJson,
          dispatchToken ?? null, dispatchTokenAt ?? null, String(id), fromStatus);
      return res.changes === 1 ? this.missionGet(id) : null;
    },
    // Artifact-only updates (step progress inside plan_json, report text)
    // never touch the status machine — the planner owns these fields.
    missionPatchArtifacts(id, { plan, report } = {}) {
      const res = db.prepare(`UPDATE wanxing_missions SET
        ${plan !== undefined ? "plan_json = ?," : ""}${report !== undefined ? "report_json = ?," : ""}
        updated_at = ? WHERE id = ?`)
        .run(...(plan !== undefined ? [JSON.stringify(plan)] : []), ...(report !== undefined ? [JSON.stringify(report)] : []), now(), String(id));
      return res.changes === 1 ? this.missionGet(id) : null;
    },
    // Writeback idempotency (D3): read-first replay, record-after-process —
    // the winner's recorded result is what every replay returns.
    missionWritebackGet(missionId, idemKey) {
      const row = db.prepare(`SELECT kind, result FROM wanxing_mission_writebacks WHERE mission_id = ? AND idem_key = ?`).get(String(missionId), String(idemKey));
      return row ? { kind: row.kind, result: JSON.parse(row.result) } : null;
    },
    missionWritebackRecord(missionId, idemKey, kind, result) {
      db.prepare(`INSERT INTO wanxing_mission_writebacks (mission_id, idem_key, kind, result, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING`).run(String(missionId), String(idemKey), String(kind), JSON.stringify(result), now());
    },

    // ── Facade meta ─────────────────────────────────────────────────────────
    metaGet(key) {
      const r = db.prepare(`SELECT value FROM wanxing_meta WHERE key = ?`).get(String(key));
      return r ? r.value : null;
    },
    metaPut(key, value) {
      db.prepare(`INSERT INTO wanxing_meta (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(String(key), String(value), now());
    },

    // ── Deployer earnings (add-deployer-revenue-share D2) ────────────────────
    // Insert-or-ignore keyed by usage_id: a second creditShare pass for the
    // same turn (inline vs sweep race, crash-window backfill) is a no-op, and
    // the caller distinguishes "already there" via earningsGet.
    earningsInsertOrIgnore(row) {
      const res = db.prepare(`INSERT INTO wanxing_deployer_earnings (usage_id, deployer_user_id, deployer_email, agent_slug, revenue_usd, amount_usd, commission, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(usage_id) DO NOTHING`)
        .run(row.usageId, Number(row.deployerUserId), String(row.deployerEmail || ""), String(row.agentSlug),
          row.revenueUsd, row.amountUsd, row.commission, now());
      return res.changes === 1;
    },
    earningsGet(usageId) {
      const r = db.prepare(`SELECT * FROM wanxing_deployer_earnings WHERE usage_id = ?`).get(String(usageId));
      if (!r) return null;
      return { usageId: r.usage_id, deployerUserId: r.deployer_user_id, deployerEmail: r.deployer_email, agentSlug: r.agent_slug,
        revenueUsd: r.revenue_usd, amountUsd: r.amount_usd, commission: r.commission, status: r.status, createdAt: r.created_at, settledAt: r.settled_at };
    },
    earningsMarkSettled(usageId) {
      db.prepare(`UPDATE wanxing_deployer_earnings SET status = 'settled', settled_at = ? WHERE usage_id = ? AND status = 'pending'`).run(now(), String(usageId));
    },
    earningsPending() {
      return db.prepare(`SELECT usage_id FROM wanxing_deployer_earnings WHERE status = 'pending' ORDER BY created_at LIMIT 200`).all()
        .map((r) => this.earningsGet(r.usage_id));
    },
    earningsForDeployer(deployerUserId, limit = 50) {
      return db.prepare(`SELECT usage_id FROM wanxing_deployer_earnings WHERE deployer_user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(Number(deployerUserId), Math.max(1, Math.min(Number(limit) || 50, 200)))
        .map((r) => this.earningsGet(r.usage_id));
    },
    earningsTotals(deployerUserId) {
      const r = db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN status = 'settled' THEN amount_usd ELSE 0 END), 0) AS settledUsd,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_usd ELSE 0 END), 0) AS pendingUsd,
        COUNT(*) AS turns
        FROM wanxing_deployer_earnings WHERE deployer_user_id = ?`).get(Number(deployerUserId));
      return r;
    },
    // Reconciliation input (D3): usage rows settled after the epoch through
    // the external deduction path with billable minutes that have no share
    // twin — the crash window between usageMarkSettled and the earnings
    // insert, closed by the sweep. share_epoch's absence (pre-change
    // database) yields no rows, which is exactly "no retroactivity".
    usageSettledSinceWithoutShare(epochMs, limit = 100) {
      const rows = db.prepare(`SELECT u.id FROM wanxing_usage u
        LEFT JOIN wanxing_deployer_earnings e ON e.usage_id = u.id
        WHERE u.settlement_status = 'settled' AND u.settled_at >= ? AND u.channel = 'api' AND u.settler IS NULL
          AND u.minutes_billed > 0 AND e.usage_id IS NULL
        ORDER BY u.settled_at LIMIT ?`).all(Number(epochMs), Math.max(1, Math.min(Number(limit) || 100, 500)));
      return rows.map((r) => this.usageGet(r.id));
    },
  };
}
