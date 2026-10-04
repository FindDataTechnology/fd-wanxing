// ── Wanxing facade bootstrap (add-facade-extraction) ─────────────────────────
//
// The standalone entry: same routes as the gateway-mounted era (minus the
// login-scoped management trio — see routes.js header), env contract
// unchanged so deployment values move over mechanically.

import path from "node:path";
import express from "express";
import { registerWanxingRoutes } from "./routes.js";

const dataRoot = process.env.WANXING_DATA_ROOT || path.resolve("data");
const app = express();
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
