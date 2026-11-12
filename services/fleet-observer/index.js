// ── fleet-observer bootstrap ─────────────────────────────────────────────────
// Env-shaped entry; tests build the app via createObserver directly.

import path from "node:path";
import { createObserver } from "./observer.js";
import { resolve, resolveBase } from "../wanxing-facade/env.js";

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

const dataRoot = process.env.FLEET_DATA_ROOT || path.resolve("data");
const observer = createObserver({
  dataRoot,
  ingestToken: resolve("observer", "ingest", process.env).token ?? "",
  registryUrl: resolveBase("observer", "registry", process.env).value ?? "",
  registryToken: resolve("observer", "registry", process.env).token ?? "",
  pollIntervalMs: num(process.env.FLEET_POLL_SECS, 30) * 1000,
  rollupIntervalMs: num(process.env.FLEET_ROLLUP_SECS, 60) * 1000,
  retentionMs: num(process.env.FLEET_RETENTION_DAYS, 14) * 24 * 3600_000,
  log: (m) => console.log(`[fleet-observer] ${m}`),
  // Stats plane (add-stats-plane-v1): collector token env-provision (hash at
  // boot), sub2api read-only pull credentials.
  collectorToken: resolve("observer", "stats", process.env).token ?? "",
  // The deployment manifest names the pair …_BASE_URL / …_TOKEN (matching
  // wanxing-facade's SUB2API_BASE_URL); BASE_URL is canonical, bare BASE is
  // the historical alias.
  sub2api: resolve("observer", "sub2api", process.env).value && resolve("observer", "sub2api", process.env).token
    ? { baseUrl: resolve("observer", "sub2api", process.env).value, token: resolve("observer", "sub2api", process.env).token }
    : null,
});

const port = num(process.env.FLEET_PORT, 3200);
observer.start();
observer.app.listen(port, "0.0.0.0", () => {
  console.log(`[fleet-observer] listening on 0.0.0.0:${port} data=${dataRoot} registry=${observer.bookkeeper ? "on" : "off"}`);
});
