#!/usr/bin/env node
// ── Million-row/day-shape soak, accelerated (add-fleet-event-backbone 6.2) ──
//
// Local accelerated stand-in for the 24h soak: 1,000,000 synthetic events
// (5,000-agent fleet, turn-heavy mix) through the real /ingest HTTP path,
// then rollup passes, rollup queries, retention, and an honest board latency
// measurement. Pass lines follow the task text (ingest sustained, rollup
// recompute + query, cleanup); board latency is REPORTED, not gated — the
// board's raw-synthesis part at a sustained 1M/day is a known follow-up
// (rollup-only path), noted in the change design.
//
//   node scripts/bench-fleet-million.mjs [--events N]

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { createObserver } from "../services/fleet-observer/observer.js";
import { ulid } from "../services/fleet-observer/ulid.js";

const TOTAL = Number.parseInt(process.argv.includes("--events") ? process.argv[process.argv.indexOf("--events") + 1] : "1000000", 10);
const AGENTS = 5000;
const BATCH = 5000;
const TOKEN = "bench";

const tmp = mkdtempSync(path.join(tmpdir(), "fleet-soak-"));
const obs = createObserver({ dataRoot: tmp, ingestToken: TOKEN });
const srv = http.createServer(obs.app);
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;

const DAY = 24 * 3600_000;
const dayStart = Date.now() - DAY;
let n = 0;
const t0 = performance.now();
let ulidTs = Date.now();
for (let done = 0; done < TOTAL; done += BATCH) {
  const events = [];
  for (let i = 0; i < BATCH && done + i < TOTAL; i++) {
    const a = Math.floor(Math.random() * AGENTS);
    const r = Math.random();
    const kind = r < 0.42 ? "turn_started" : r < 0.84 ? "turn_ended" : r < 0.9 ? "state_changed" : r < 0.94 ? "settled" : r < 0.97 ? "woken" : "reaped";
    events.push({
      id: ulid(++ulidTs),
      source: "runner:bench1",
      agent: `packs-p${a}-deployments-agent`,
      runner: "bench1",
      kind,
      ts: dayStart + Math.floor(Math.random() * DAY),
      payload: kind === "turn_ended" ? { outcome: Math.random() < 0.05 ? "error" : "ok", duration_ms: 5000 } : kind === "turn_started" ? { wake_ms: 800 + Math.floor(Math.random() * 4000) } : kind === "settled" ? { minutes_billed: 1, usd: 0.02, settlement_status: "settled" } : {},
    });
    n++;
  }
  // Idempotent by event id: a dropped connection retries the same batch —
  // the store's dedupe makes the retry exactly-once.
  let j = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${base}/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ events }),
      });
      j = await res.json();
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (j.accepted !== events.length) throw new Error(`batch accepted ${j.accepted}/${events.length}`);
  if ((done / BATCH) % 50 === 0) console.log(`  … ${done.toLocaleString()}/${TOTAL.toLocaleString()} events`);
}
const ingestMs = performance.now() - t0;

const t1 = performance.now();
obs.rollupPass(26); // a day's worth of hour recomputes
const rollupMs = performance.now() - t1;

const t2 = performance.now();
let boardDoc = null;
const boardLat = [];
for (let i = 0; i < 3; i++) {
  const s = performance.now();
  const r = await fetch(`${base}/api/fleet/v1/board`, { headers: { authorization: `Bearer ${TOKEN}` } });
  boardDoc = await r.json();
  boardLat.push(performance.now() - s);
}
const boardMs = Math.round(boardLat.reduce((a, b) => a + b, 0) / boardLat.length);

const t3 = performance.now();
const deleted = obs.store.retain(Date.now(), DAY - 3600_000); // keep ~1h
const cleanupMs = performance.now() - t3;

const hours = 24;
const t4 = performance.now();
const rows = obs.store.rollupRows(Array.from({ length: hours }, (_, i) => new Date(Date.now() - i * 3600_000).toISOString().slice(0, 13) + ":00"));
const rollupQueryMs = performance.now() - t4;
const turns = rows.reduce((a, r) => a + r.turns, 0);

const ok = (name, cond, detail) => {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name} — ${detail}`);
  return cond ? 0 : 1;
};

console.log(`bench-fleet-million events=${TOTAL} agents=${AGENTS}`);
let fail = 0;
fail += ok("ingest sustained ≥ 5k events/s", n / (ingestMs / 1000) >= 5000, `${Math.round(n / (ingestMs / 1000)).toLocaleString()} ev/s over ${Math.round(ingestMs / 1000)}s`);
fail += ok("24h rollup recompute < 120s", rollupMs < 120_000, `${(rollupMs / 1000).toFixed(1)}s`);
fail += ok("rollup query (24 hours) < 250ms", rollupQueryMs < 250, `${Math.max(1, Math.round(rollupQueryMs))}ms, ${rows.length} rows`);
fail += ok("retention pass ran", deleted > 0, `deleted ${deleted.toLocaleString()} rows in ${(cleanupMs / 1000).toFixed(1)}s`);
fail += ok("rollup turns sane", turns > 0, `turns=${turns.toLocaleString()}`);
console.log(`  note board latency (reported, not gated): ${boardMs}ms avg over 3 reads — raw synthesis at sustained 1M/day is the follow-up`);

obs.close();
srv.close();
rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
