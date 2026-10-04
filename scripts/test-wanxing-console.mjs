#!/usr/bin/env node
// ── Console management surface tests (⑤ increment 1) ────────────────────────
//
//   node --test scripts/test-wanxing-console.mjs
//
// Token gate, deployments list (snapshot + registry enrichment), pause/resume
// (registry metadata upsert), allowlist add/list/remove with the sub2api
// email→id resolution and the NO_SUB2API_ACCOUNT refusal.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { test } from "node:test";

const { registerWanxingRoutes } = await import("../services/wanxing-facade/routes.js");
const { slugFor } = await import("../services/wanxing-facade/core.js");

const tmp = mkdtempSync(path.join(tmpdir(), "wx-console-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const TOKEN = "ingest-tok";
const rows = [{ packId: "Pk1", agentId: "agent", version: 1, agentPath: "/packs/Pk1/deployments/agent" }];
const slug = slugFor(rows[0].agentPath);
const registryWrites = [];

function harness() {
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (req, res) => {
    if (req.headers.authorization !== "Bearer svc") return res.status(401).json({});
    res.json({ deployments: rows });
  });
  const packsSrv = http.createServer(packsApp).listen(0);
  return new Promise((resolve) => packsSrv.once("listening", () => {
    const env = {
      PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
      AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
      AGENT_SERVING_REGISTRY_TOKEN: "svc",
      FLEET_OBSERVER_TOKEN: TOKEN,
    };
    const entry = { name: "S", visibility: "public", metadata: {} };
    const fetchImpl = async (url, init = {}) => {
      if (url.startsWith("http://127.0.0.1:")) return fetch(url, init);
      if (url.startsWith("https://reg.internal/api/agents/packs/Pk1")) {
        if (init.method === "PUT") registryWrites.push(JSON.parse(init.body));
        return new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } });
      }
      if (url.startsWith("https://reg.internal/agent/")) return new Response("{}", { status: 404 });
      return new Response("{}", { status: 404 });
    };
    const app = express();
    const wired = registerWanxingRoutes(app, {
      dataRoot: path.join(tmp, `d-${Math.random().toString(36).slice(2)}`),
      env,
      fetchImpl,
      sub2api: {
        degraded: () => false,
        async findUserByEmail(email) {
          return email === "known@x.test" ? { userId: 7, email } : null;
        },
      },
    });
    const srv = http.createServer(app).listen(0);
    srv.once("listening", () => resolve({ wired, srv, base: `http://127.0.0.1:${srv.address().port}`, packsSrv }));
  }));
}

const H = { Authorization: `Bearer ${TOKEN}` };

test("console: gate, deployments list, pause/resume upsert, allowlist flow", async () => {
  const { wired, srv, base, packsSrv } = await harness();
  try {
    // gate
    assert.equal((await fetch(`${base}/api/wanxing/v1/console/deployments`)).status, 401);
    // deployments list (snapshot + enrichment)
    const list = await (await fetch(`${base}/api/wanxing/v1/console/deployments`, { headers: H })).json();
    assert.equal(list.deployments.length, 1);
    assert.equal(list.deployments[0].slug, slug);
    assert.equal(list.deployments[0].name, "S");
    assert.equal(list.deployments[0].paused, false);

    // pause → registry metadata upsert
    const p = await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/pause`, { method: "POST", headers: H });
    assert.equal(p.status, 200);
    assert.equal((await p.json()).paused, true);
    assert.equal(registryWrites.length, 1);
    assert.equal(registryWrites[0].metadata.paused, true);

    // resume → upsert clears the flag
    await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/resume`, { method: "POST", headers: H });
    assert.equal(registryWrites.length, 2);
    assert.equal(registryWrites[1].metadata.paused, undefined);

    // allowlist: unknown sub2api account → structured 404
    const no = await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/callers`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ email: "nobody@x.test" }),
    });
    assert.equal(no.status, 404);
    assert.equal((await no.json()).code, "NO_SUB2API_ACCOUNT");

    // add known → list → remove
    const add = await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/callers`, {
      method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ email: "Known@X.Test" }),
    });
    assert.equal(add.status, 200);
    assert.equal((await add.json()).caller.userId, 7);
    const listed = await (await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/callers`, { headers: H })).json();
    assert.equal(listed.callers.length, 1);
    assert.equal(listed.callers[0].email, "known@x.test");
    const del = await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/callers`, {
      method: "DELETE", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ userId: 7 }),
    });
    assert.equal(del.status, 200);
    const after = await (await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/callers`, { headers: H })).json();
    assert.equal(after.callers.length, 0);
  } finally {
    wired.close();
    await new Promise((r) => srv.close(r));
    await new Promise((r) => packsSrv.close(r));
  }
});
