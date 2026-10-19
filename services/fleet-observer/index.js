// ── fleet-observer bootstrap ─────────────────────────────────────────────────
// Env-shaped entry; tests build the app via createObserver directly.

import path from "node:path";
import { createObserver } from "./observer.js";

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

const dataRoot = process.env.FLEET_DATA_ROOT || path.resolve("data");
const observer = createObserver({
  dataRoot,
  ingestToken: process.env.FLEET_INGEST_TOKEN || "",
  registryUrl: (process.env.FLEET_REGISTRY_URL || "").replace(/\/+$/, ""),
  registryToken: process.env.FLEET_REGISTRY_TOKEN || "",
  pollIntervalMs: num(process.env.FLEET_POLL_SECS, 30) * 1000,
  rollupIntervalMs: num(process.env.FLEET_ROLLUP_SECS, 60) * 1000,
  retentionMs: num(process.env.FLEET_RETENTION_DAYS, 14) * 24 * 3600_000,
  log: (m) => console.log(`[fleet-observer] ${m}`),
  // Stats plane (add-stats-plane-v1): collector token env-provision (hash at
  // boot), sub2api read-only pull credentials.
  collectorToken: process.env.FLEET_STATS_COLLECTOR_TOKEN || "",
  // The deployment manifest names the pair …_BASE_URL / …_TOKEN (matching
  // wanxing-facade's SUB2API_BASE_URL); BASE_URL is canonical, bare BASE is
  // the historical alias.
  sub2api: ((process.env.FLEET_STATS_SUB2API_BASE_URL || process.env.FLEET_STATS_SUB2API_BASE) && process.env.FLEET_STATS_SUB2API_TOKEN)
    ? { baseUrl: process.env.FLEET_STATS_SUB2API_BASE_URL || process.env.FLEET_STATS_SUB2API_BASE, token: process.env.FLEET_STATS_SUB2API_TOKEN }
    : null,
});

const port = num(process.env.FLEET_PORT, 3200);
observer.start();
observer.app.listen(port, "0.0.0.0", () => {
  console.log(`[fleet-observer] listening on 0.0.0.0:${port} data=${dataRoot} registry=${observer.bookkeeper ? "on" : "off"}`);
});
