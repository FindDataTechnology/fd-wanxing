#!/usr/bin/env node
// ── Catalog latency probe (catalog-joins-never-block D5) ────────────────────
//
// Measures the post-TTL-expiry cost of the public catalog against the same
// host's /status baseline. Run it before and after a deploy; the verdict is
// the DIFFERENCE between the two paths, not an absolute millisecond count
// (the network from wherever you run it is part of every number).
//
//   node scripts/probe-catalog-latency.mjs https://wanxing.finddatatech.cloud [rounds]
//
// Each round idles past the 60s TTL, then times /agents and /status. The
// first request is discarded (cold process). Exit code is always 0: this is a
// census, not a gate — read the printed verdict.

const base = (process.argv[2] || "").replace(/\/+$/, "");
const rounds = Math.max(1, Number.parseInt(process.argv[3] || "3", 10) || 3);
const TTL_IDLE_MS = 61_000;
const TARGET_DIFF_MS = 100;

if (!base) {
  console.error("usage: node scripts/probe-catalog-latency.mjs <base-url> [rounds]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeOne = async (path) => {
  const t0 = performance.now();
  try {
    const res = await fetch(base + path, { signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    return { ms: performance.now() - t0, status: res.status, bytes: body.length };
  } catch (e) {
    return { ms: performance.now() - t0, status: `error: ${e?.name ?? e}`, bytes: 0 };
  }
};

const p50 = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

await timeOne("/api/wanxing/v1/agents"); // cold process: discard
const results = [];
for (let i = 1; i <= rounds; i += 1) {
  process.stderr.write(`round ${i}/${rounds}: idling ${TTL_IDLE_MS / 1000}s past the cache TTL…\n`);
  await sleep(TTL_IDLE_MS);
  // Warm the TCP/TLS connection first: the first request of a round otherwise
  // pays the handshake, and whichever path runs first would look slower.
  await timeOne("/api/wanxing/v1/status");
  const agents = await timeOne("/api/wanxing/v1/agents");
  const status = await timeOne("/api/wanxing/v1/status");
  results.push({ round: i, agentsMs: Math.round(agents.ms), statusMs: Math.round(status.ms), diffMs: Math.round(agents.ms - status.ms), agentsStatus: agents.status, statusStatus: status.status });
}

const agentsP50 = p50(results.map((r) => r.agentsMs));
const statusP50 = p50(results.map((r) => r.statusMs));
const diffP50 = agentsP50 - statusP50;
console.log(JSON.stringify({
  base,
  rounds: results,
  p50: { agentsMs: agentsP50, statusMs: statusP50, diffMs: diffP50 },
  target: { diffMsAtMost: TARGET_DIFF_MS },
  verdict: diffP50 <= TARGET_DIFF_MS ? "within-target" : "above-target",
}, null, 2));
