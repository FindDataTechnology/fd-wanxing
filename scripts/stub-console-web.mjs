#!/usr/bin/env node
// ── Console web stub server (add-plan-requests-and-move-statement 2.x) ───────
//
// The web face has no unit-test rig; its acceptance is "serve the built dist
// behind the REAL console routes on stubbed dependencies, then assert the
// DOM in a browser". This is that server: wanxing-web/dist with the SPA
// fallback, plus registerConsoleRoutes wired exactly like routes.js but with
// an in-memory sub2api, a token-map Logto, empty bookkeeping, and a minimal
// fleet observer. The store is a throwaway SQLite file, so the plan-request
// queue and plans behave for real across the browser's calls.
//
//   node --test scripts/test-*.mjs       # facade contract (this is NOT that)
//   node scripts/stub-console-web.mjs [port]
//
// Browser credentials (localStorage key wanxing-console-token):
//   walk-ops     → the ops service token (no identity; plans/queue management)
//   walk-caller  → caller@finddata.tech, sub2api user 7
//   walk-peer    → peer@finddata.tech,   sub2api user 9

import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import express from "express";

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { registerConsoleRoutes } = await import("../services/wanxing-facade/console.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../wanxing-web/dist");
if (!existsSync(path.join(dist, "index.html"))) {
  console.error(`dist not built: ${dist} — run \`npm run build\` in wanxing-web first`);
  process.exit(2);
}

const OPS_TOKEN = "walk-ops";
const IDENTITIES = { "walk-caller": "caller@finddata.tech", "walk-peer": "peer@finddata.tech" };
const ACCOUNTS = [
  { userId: 7, email: "caller@finddata.tech" },
  { userId: 9, email: "peer@finddata.tech" },
];
const sub2api = {
  degraded: () => false,
  async probeKeyLiveness() { return { ok: true }; },
  async findUserByKey() { return ACCOUNTS[0]; },
  async findUserByEmail(mail) { return ACCOUNTS.find((a) => a.email === String(mail).toLowerCase()) ?? null; },
  async adjustBalance() { return { ok: true }; },
};

const tmp = mkdtempSync(path.join(tmpdir(), "wx-stub-web-"));
const store = createWanxingStore({ file: path.join(tmp, "wanxing.db") });

const jsonResponse = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const app = express();
registerConsoleRoutes(app, {
  requireToken: (req) => req.headers.authorization === `Bearer ${OPS_TOKEN}`,
  logtoAuth: {
    configured: true,
    appId: "stub", endpoint: "http://stub.invalid",
    verifyIdToken: async (token) => (IDENTITIES[token] ? { email: IDENTITIES[token] } : null),
  },
  bookkeeping: { rows: async () => [], resolve: async () => null },
  store,
  sub2api,
  registryFetch: async () => jsonResponse({}),
  observerFetch: async (p) => {
    if (p.startsWith("/api/fleet/v1/board")) return jsonResponse({ window: "24h", agents_total: 0, states: {}, runners: {}, ingest_lag: [], settled_pending: {}, wake_ms: {}, missions: [], cells: {} });
    if (p.startsWith("/api/fleet/v1/stats/overview")) return jsonResponse({ fleet: [], sub2api: null });
    if (p.startsWith("/api/fleet/v1/stats/daily")) return jsonResponse({ fleet: [] });
    if (p.startsWith("/api/fleet/v1/cell-fleets")) {
      // add-fleet-cockpit-projection walk fixtures: CELL_FLEETS_FIXTURE
      //   full(default): two cells — one fresh with health/decision/stream
      //                    lines, one 2h-stale
      //   empty:         200 with zero cells  → section hides
      //   missing:       404                  → section hides (old observer)
      const mode = String(process.env.CELL_FLEETS_FIXTURE || "full");
      if (mode === "missing") return new Response("not found", { status: 404 });
      if (mode === "empty") return jsonResponse({ window: "6h", cells: {} });
      const t = Date.now();
      const mkFleet = (id, name, stale) => ({
        id, name, state: "active",
        counts: { onDuty: 2, paused: 1, missing: stale ? 0 : 1, vacant: 0, passive: 1, failing: 0, total: 4 },
        openDecisions: { count: 2, top: [
          { question: stale ? "旧快照里的题面" : "双11预算上限要不要放开到 $2000/天？", severity: "high", expiresAt: t + 20 * 3600_000, memberTitle: "CEO" },
          { question: "开源部 GitHub PAT 谁来申请", severity: "normal", expiresAt: t + 60 * 3600_000, memberTitle: "开源部" },
        ] },
        stream: [
          { title: "CEO", status: "on_duty", at: stale ? t - 2 * 3600_000 : t - 60_000, source: "self", metrics: { patrol_notes: "9/9" }, summarySnip: stale ? "陈旧样例" : "巡视汇总：电商连接器凭据仍缺，投资部拒绝编造 pnl。" },
          { title: "电商部", status: stale ? "on_duty" : "missing", at: stale ? t - 2 * 3600_000 : t - 1800_000, source: "self", metrics: { sales_week: 0 }, summarySnip: "店铺订单数无法获取，待补岗" },
        ],
      });
      return jsonResponse({
        window: "6h",
        cells: {
          "cell:walker@finddata.tech": {
            sampledAt: t - 30_000, seen_at: t - 30_000, ageMs: 30_000, stale: false, v: 1,
            fleets: [mkFleet("fleet_walk_fresh", "公司式舰队", false)],
          },
          "cell:leeping@finddata.tech": {
            sampledAt: t - 2 * 3600_000, seen_at: t - 2 * 3600_000, ageMs: 2 * 3600_000, stale: true, v: 1,
            fleets: [mkFleet("fleet_walk_stale", "陈旧舰队", true)],
          },
        },
      });
    }
    return jsonResponse({ rows: [] });
  },
  log: (m) => console.log(`[stub] ${m}`),
});
// Self-service faces outside console.js that the fleet tab reads on mount.
app.get("/api/wanxing/v1/console/my/earnings", (_req, res) => res.json({ totals: { settledUsd: 0, pendingUsd: 0, turns: 0 }, rows: [] }));
app.get("/api/wanxing/v1/console/my/packs", (_req, res) => res.json({ packs: [] }));
app.get("/api/wanxing/v1/console/fleet/summary", (_req, res) => res.json({ agents: {} }));

app.use(express.static(dist));
app.get(/.*/, (_req, res) => res.type("html").send(readFileSync(path.join(dist, "index.html"))));

const port = Number(process.argv[2]) || 0;
const server = http.createServer(app).listen(port, "127.0.0.1", () => {
  console.log(JSON.stringify({ base: `http://127.0.0.1:${server.address().port}`, ops: OPS_TOKEN, identities: IDENTITIES, db: path.join(tmp, "wanxing.db") }));
});
