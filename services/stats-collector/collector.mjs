#!/usr/bin/env node
// ── stats-collector (add-stats-plane-v1 D5) ──────────────────────────────────
//
// Local harness consumption collector: parses local logs incrementally
// (parser registry under parsers/), batches hourly, posts to the fleet
// observer's /ingest/local endpoint over tailnet with an fsc_ collector token.
//
//   OBSERVER_URL=http://100.64.0.8:31881 FSC_TOKEN=fsc_… node collector.mjs --once
//   node collector.mjs --interval 3600   # hourly loop
//
// State: ~/.stats-collector/state.json (per-file byte offsets). Skipping a
// vanished file forgets it; a truncated file (size < offset) rescans from 0
// only for that file.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import * as claudeCode from "./parsers/claude-code.js";
import { resolve, resolveBase } from "../wanxing-facade/env.js";

const PARSERS = [claudeCode];

const STATE_DIR = join(homedir(), ".stats-collector");
const STATE_FILE = join(STATE_DIR, "state.json");

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return { files: {} }; }
}
function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}

async function runOnce({ observerUrl, token, now = Date.now, fetchImpl = fetch, log = console }) {
  const state = loadState();
  const events = [];
  let skippedTotal = 0;
  for (const parser of PARSERS) {
    for (const file of parser.discover()) {
      try {
        const { events: found, nextOffset, skipped } = parser.parseSince(file, state.files[file]);
        events.push(...found);
        skippedTotal += skipped;
        state.files[file] = { offset: nextOffset, seen: now() };
      } catch (e) {
        // Unreadable/rotated file: forget the site; next appearance rescans.
        delete state.files[file];
        skippedTotal += 1;
      }
    }
  }
  let stored = 0;
  let rejected = false;
  if (events.length) {
    for (let i = 0; i < events.length; i += 1000) {
      const batch = events.slice(i, i + 1000).map((e, k) => ({ ...e, id: `cc:${e.session}:${e.ts}:${i + k}` }));
      try {
        const res = await fetchImpl(`${observerUrl.replace(/\/+$/, "")}/ingest/local`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ events: batch }),
        });
        if (!res.ok) { rejected = true; log.error(`post rejected: HTTP ${res.status}`); break; }
        const body = await res.json().catch(() => ({}));
        stored += body.stored ?? batch.length;
      } catch (e) {
        rejected = true;
        log.error(`post failed: ${e.message}`);
        break;
      }
    }
  }
  // Only advance offsets when delivery succeeded — a rejected batch re-reads.
  if (!rejected) saveState(state);
  return { found: events.length, stored, skipped: skippedTotal, delivered: !rejected };
}

async function main() {
  const observerUrl = resolveBase("collector", "observer", process.env).value ?? "";
  const token = resolve("collector", "observer", process.env).token ?? "";
  if (!observerUrl || !token || !token.startsWith("fsc_")) {
    console.error("needs OBSERVER_URL and FSC_TOKEN (fsc_…)");
    process.exit(2);
  }
  const args = process.argv.slice(2);
  if (args.includes("--once") || args.length === 0) {
    const out = await runOnce({ observerUrl, token });
    console.log(JSON.stringify(out));
    return;
  }
  const i = args.indexOf("--interval");
  const secs = i >= 0 ? Number(args[i + 1]) : 3600;
  console.log(`stats-collector running every ${secs}s`);
  for (;;) {
    try {
      const out = await runOnce({ observerUrl, token });
      console.log(new Date().toISOString(), JSON.stringify(out));
    } catch (e) { console.error("cycle error:", e.message); }
    await new Promise((r) => setTimeout(r, secs * 1000));
  }
}

// --once default; importable for tests
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { runOnce, loadState, saveState, STATE_FILE };
