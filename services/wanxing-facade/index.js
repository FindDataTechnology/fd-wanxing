// ── Wanxing facade bootstrap (add-facade-extraction) ─────────────────────────
//
// The standalone entry: same routes as the gateway-mounted era (minus the
// login-scoped management trio — see routes.js header), env contract
// unchanged so deployment values move over mechanically.

import path from "node:path";
import express from "express";
import { registerWanxingRoutes } from "./routes.js";

// Startup fail-fast (wanxing-contract-hardening 2.1): these two are the
// turn/catalog main path's dependencies, not optional integrations — a
// deployment missing either would boot into a facade that cannot admit or
// resolve anything. Refuse to start and name the variable, rather than run
// degraded (degraded is only honest for optional dependencies). Test
// injections bypass this entry, so registerWanxingRoutes stays assert-free.
const REQUIRED_ENV = ["SUB2API_BASE_URL", "PACKS_INTERNAL_BASE_URL"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[wanxing-facade] refusing to start: missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const dataRoot = process.env.WANXING_DATA_ROOT || path.resolve("data");
const app = express();
// The facade sits behind the TLS-terminating edge (SafeLine/Caddy): honor
// X-Forwarded-Proto so card/catalog/cluster URLs carry https — without this
// every composed url rendered http:// and the copyable cluster endpoint
// shipped the wrong scheme (live finding 2026-10-22).
app.set("trust proxy", true);
const wired = registerWanxingRoutes(app, { dataRoot });

const port = Number(process.env.WANXING_PORT || 3080);
app.listen(port, "0.0.0.0", () => {
  console.log(`[wanxing-facade] listening on 0.0.0.0:${port} data=${dataRoot}`);
});

const stop = () => {
  try { wired.close(); } catch { /* best-effort */ }
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
