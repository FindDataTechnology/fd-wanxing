// ── stats store (add-stats-plane-v1) ─────────────────────────────────────────
//
// The stats plane's own persistence: a SISTER database beside fleet-events.db
// (same data root, same isolation rule). The observation store keeps its 14d
// retention untouched; this store keeps turn-level usage detail for 13 months
// (rolling) and daily rollups forever. Every number carries (source, basis) —
// the API layer refuses to emit merged figures across calibers.

import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DETAIL_RETENTION_MONTHS = 13;

// agent slugs are "packs-<packId>-<agentName>" with base62 pack ids (no "-"
// inside packId); degrade to agent-as-pack when the shape doesn't match.
export function packOfAgent(agent) {
  if (typeof agent !== "string") return "";
  if (!agent.startsWith("packs-")) return "";
  const rest = agent.slice("packs-".length);
  const i = rest.indexOf("-");
  return i > 0 ? rest.slice(0, i) : rest;
}

export function createStatsStore({ file }) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_rows (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      agent TEXT NOT NULL,
      pack TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      session TEXT,
      harness TEXT,
      source TEXT NOT NULL,
      basis TEXT NOT NULL,
      turn_kind TEXT,
      outcome TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_rows(ts);
    CREATE INDEX IF NOT EXISTS idx_usage_agent_ts ON usage_rows(agent, ts);

    CREATE TABLE IF NOT EXISTS rollup_day (
      day TEXT NOT NULL,
      agent TEXT NOT NULL,
      pack TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      basis TEXT NOT NULL,
      turns INTEGER NOT NULL DEFAULT 0,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      cache_write INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, agent, pack, model, source, basis)
    );

    CREATE TABLE IF NOT EXISTS sub2api_day (
      day TEXT NOT NULL,
      bucket TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'usage',
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      requests INTEGER NOT NULL DEFAULT 0,
      cost TEXT,
      currency TEXT,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (day, bucket, kind)
    );

    CREATE TABLE IF NOT EXISTS collector_tokens (
      token_hash TEXT PRIMARY KEY,
      label TEXT,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const dayOf = (tsMs) => new Date(tsMs).toISOString().slice(0, 10);

  function recordUsage(rows) {
    const ins = db.prepare(`INSERT OR IGNORE INTO usage_rows
      (id, ts, agent, pack, model, session, harness, source, basis, turn_kind, outcome, tokens_in, tokens_out, cache_read, cache_write, duration_ms)
      VALUES (@id, @ts, @agent, @pack, @model, @session, @harness, @source, @basis, @turn_kind, @outcome, @tokens_in, @tokens_out, @cache_read, @cache_write, @duration_ms)`);
    const tx = db.transaction((list) => {
      for (const r of list) {
        ins.run({
          id: r.id,
          ts: Number(r.ts),
          agent: String(r.agent ?? ""),
          pack: String(r.pack ?? packOfAgent(r.agent)),
          model: String(r.model ?? ""),
          session: r.session ?? null,
          harness: r.harness ?? null,
          source: String(r.source),
          basis: String(r.basis),
          turn_kind: r.turn_kind ?? null,
          outcome: r.outcome ?? null,
          tokens_in: Number(r.tokens_in) || 0,
          tokens_out: Number(r.tokens_out) || 0,
          cache_read: Number(r.cache_read) || 0,
          cache_write: Number(r.cache_write) || 0,
          duration_ms: Number.isFinite(Number(r.duration_ms)) ? Number(r.duration_ms) : null,
        });
      }
    });
    tx(rows);
    return rows.length;
  }

  // Idempotent per-day recompute from detail (details are the truth; rollups
  // are derived and rebuildable — same discipline as the memory plane's OKF).
  function rollupDay(day) {
    const s = Date.parse(day + "T00:00:00Z");
    const e = s + 86_400_000;
    const grouped = db.prepare(`SELECT agent, pack, model, source, basis,
        COUNT(*) AS turns, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
        SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write
      FROM usage_rows WHERE ts >= ? AND ts < ? GROUP BY agent, pack, model, source, basis`).all(s, e);
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM rollup_day WHERE day = ?").run(day);
      const ins = db.prepare(`INSERT INTO rollup_day
        (day, agent, pack, model, source, basis, turns, tokens_in, tokens_out, cache_read, cache_write)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      for (const g of grouped) {
        ins.run(day, g.agent, g.pack, g.model, g.source, g.basis, g.turns,
          g.tokens_in ?? 0, g.tokens_out ?? 0, g.cache_read ?? 0, g.cache_write ?? 0);
      }
    });
    tx();
    return grouped.length;
  }

  function pruneDetail(nowMs = Date.now()) {
    const cutoff = nowMs - DETAIL_RETENTION_MONTHS * 30 * 86_400_000;
    const res = db.prepare("DELETE FROM usage_rows WHERE ts < ?").run(cutoff);
    return res.changes;
  }

  function recordSub2apiDay(rows, fetchedAt) {
    const tx = db.transaction(() => {
      const ins = db.prepare(`INSERT INTO sub2api_day (day, bucket, kind, tokens_in, tokens_out, requests, cost, currency, fetched_at)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(day, bucket, kind) DO UPDATE SET tokens_in=excluded.tokens_in,
          tokens_out=excluded.tokens_out, requests=excluded.requests, cost=excluded.cost,
          currency=excluded.currency, fetched_at=excluded.fetched_at`);
      for (const r of rows) {
        ins.run(String(r.day), String(r.bucket ?? ""), String(r.kind ?? "usage"),
          Number(r.tokens_in) || 0, Number(r.tokens_out) || 0, Number(r.requests) || 0,
          r.cost != null ? String(r.cost) : null, r.currency ?? null, fetchedAt);
      }
      setMeta("sub2api_last_success", String(fetchedAt));
    });
    tx();
  }

  function setMeta(key, value) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  const getMeta = (key) => {
    const r = db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return r ? r.value : null;
  };

  // Query faces: every figure grouped by (source, basis); no merged totals.
  // by='agent' → rows keyed agent (+pack, per-pack granularity); by='model' → keyed model.
  function grouped(sinceMs, by /* 'agent' | 'model' */) {
    if (by === "model") {
      const rows = db.prepare(`SELECT model, source, basis,
          COUNT(*) AS turns, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
          SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write
        FROM usage_rows WHERE ts >= ? GROUP BY model, source, basis ORDER BY turns DESC`).all(sinceMs);
      return rows.map(norm);
    }
    const rows = db.prepare(`SELECT agent, pack, source, basis,
        COUNT(*) AS turns, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
        SUM(cache_read) AS cache_read, SUM(cache_write) AS cache_write
      FROM usage_rows WHERE ts >= ? GROUP BY agent, pack, source, basis ORDER BY turns DESC`).all(sinceMs);
    return rows.map(norm);
  }
  const norm = (r) => ({ ...r, tokens_in: r.tokens_in ?? 0, tokens_out: r.tokens_out ?? 0, cache_read: r.cache_read ?? 0, cache_write: r.cache_write ?? 0 });

  function daily(sinceMs) {
    // SQLite has no Date.parse — filter in JS (rollup_day is small)
    return db.prepare(`SELECT day, source, basis, SUM(turns) AS turns,
        SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out
      FROM rollup_day GROUP BY day, source, basis ORDER BY day`).all()
      .filter((r) => Date.parse(r.day + "T00:00:00Z") >= sinceMs)
      .map((r) => ({ ...r, turns: r.turns ?? 0, tokens_in: r.tokens_in ?? 0, tokens_out: r.tokens_out ?? 0 }));
  }

  function sub2apiDaily(sinceMs) {
    return db.prepare("SELECT day, bucket, kind, tokens_in, tokens_out, requests, cost, currency, fetched_at FROM sub2api_day ORDER BY day")
      .all()
      .filter((r) => Date.parse(r.day + "T00:00:00Z") >= sinceMs);
  }

  function overview(sinceMs) {
    const by = {};
    for (const r of grouped(sinceMs, "agent")) {
      const k = `${r.source}:${r.basis}`;
      by[k] ??= { source: r.source, basis: r.basis, turns: 0, tokens_in: 0, tokens_out: 0, agents: new Set() };
      by[k].turns += r.turns;
      by[k].tokens_in += r.tokens_in;
      by[k].tokens_out += r.tokens_out;
      by[k].agents.add(r.agent);
    }
    const fleet = Object.values(by).map((v) => ({ source: v.source, basis: v.basis, turns: v.turns, tokens_in: v.tokens_in, tokens_out: v.tokens_out, agents: v.agents.size }));
    let sub2api = null;
    const s2rows = sub2apiDaily(sinceMs);
    if (s2rows.length) {
      sub2api = { source: "sub2api", basis: "billed", rows: s2rows.length,
        tokens_in: s2rows.reduce((a, r) => a + r.tokens_in, 0),
        tokens_out: s2rows.reduce((a, r) => a + r.tokens_out, 0),
        requests: s2rows.reduce((a, r) => a + r.requests, 0) };
    }
    return { fleet, sub2api, sub2api_stale_since: Number(getMeta("sub2api_last_success")) || null };
  }

  // Collector tokens (fsc_ family, hashed at rest).
  function provisionCollectorToken(token, label) {
    const hash = createHash("sha256").update(String(token)).digest("hex");
    db.prepare("INSERT INTO collector_tokens (token_hash, label, created_at) VALUES (?,?,?)")
      .run(hash, label ?? null, Date.now());
  }
  function verifyCollectorToken(token) {
    if (typeof token !== "string" || !token.startsWith("fsc_")) return false;
    const hash = createHash("sha256").update(token).digest("hex");
    const r = db.prepare("SELECT revoked_at FROM collector_tokens WHERE token_hash=?").get(hash);
    return Boolean(r && !r.revoked_at);
  }
  function mintCollectorToken(label) {
    const token = "fsc_" + randomBytes(24).toString("hex");
    provisionCollectorToken(token, label);
    return token;
  }

  return {
    db,
    recordUsage,
    rollupDay,
    pruneDetail,
    recordSub2apiDay,
    overview,
    grouped,
    daily,
    sub2apiDaily,
    provisionCollectorToken,
    verifyCollectorToken,
    mintCollectorToken,
    close: () => db.close(),
  };
}
