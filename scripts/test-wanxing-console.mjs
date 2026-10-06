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

// ── agent-service-config: the console's config proxy ────────────────────────

import { generateKeyPairSync, sign as nodeSign } from "node:crypto";

test("console config proxy: verified identity forwards the actor; the ops token has none", async () => {
  // Real-crypto identity (the logto test's recipe): a P-384 signer + JWKS.
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "k1";
  jwk.alg = "ES384";
  const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const rawRS = (der) => {
    const lenR = der[3];
    const r = der.slice(4, 4 + lenR);
    const lenS = der[5 + lenR];
    const s = der.slice(6 + lenR, 6 + lenR + lenS);
    const pad48 = (x0) => { let x = x0; while (x.length > 1 && x[0] === 0) x = x.slice(1); return Buffer.concat([Buffer.alloc(Math.max(0, 48 - x.length)), x]); };
    return Buffer.concat([pad48(r), pad48(s)]);
  };
  const EP = "https://auth.example.test";
  const APP = "app-console-cfg";
  const sign = (payload) => {
    const h = b64u(JSON.stringify({ alg: "ES384", typ: "JWT", kid: "k1" }));
    const p = b64u(JSON.stringify(payload));
    const sig = rawRS(nodeSign("sha384", Buffer.from(`${h}.${p}`), privateKey));
    return `${h}.${p}.${b64u(sig)}`;
  };
  const idToken = sign({
    iss: `${EP}/oidc`, aud: APP, exp: Math.floor(Date.now() / 1000) + 600,
    sub: "u1", email: "deployer@x.test",
  });

  const seen = [];
  const packsApp = express();
  packsApp.use(express.json());
  packsApp.get("/api/packs/internal/deployments", (req, res) => {
    if (req.headers.authorization !== "Bearer svc") return res.status(401).json({});
    res.json({ deployments: rows });
  });
  packsApp.get("/api/packs/internal/deployments/Pk1/agent/config", (req, res) => {
    if (req.headers.authorization !== "Bearer svc") return res.status(401).json({});
    seen.push({ method: "GET", actor: req.headers["x-acting-user"] ?? null });
    if (!req.headers["x-acting-user"]) return res.status(400).json({ error: "x-acting-user required" });
    res.json({ config: { model: { effective: "m-in", source: "declared" } }, effectiveWithinSecs: 300 });
  });
  packsApp.put("/api/packs/internal/deployments/Pk1/agent/config", (req, res) => {
    if (req.headers.authorization !== "Bearer svc") return res.status(401).json({});
    seen.push({ method: "PUT", actor: req.headers["x-acting-user"] ?? null, body: req.body });
    if (!req.headers["x-acting-user"]) return res.status(400).json({ error: "x-acting-user required" });
    res.json({ ok: true, config: req.body });
  });
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));

  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith("/oidc/jwks")) {
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("http://127.0.0.1:")) return fetch(url, init);
    if (url.startsWith("https://reg.internal/agent/")) return new Response("{}", { status: 404 });
    return new Response("{}", { status: 404 });
  };
  const app = express();
  registerWanxingRoutes(app, {
    dataRoot: path.join(tmp, `cfg-${Math.random().toString(36).slice(2)}`),
    env: {
      PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
      AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
      AGENT_SERVING_REGISTRY_TOKEN: "svc",
      FLEET_OBSERVER_TOKEN: TOKEN,
      WANXING_LOGTO_ENDPOINT: EP,
      WANXING_LOGTO_APP_ID: APP,
      WANXING_CONSOLE_ALLOWLIST: "deployer@x.test",
    },
    fetchImpl,
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const url = `${base}/api/wanxing/v1/console/deployments/${slug}/config`;
  try {
    // Ops service token: gated in, but no actor → 400 (config is identity-only).
    const asOps = await fetch(url, { headers: H });
    assert.equal(asOps.status, 400);
    // Verified identity: read + write pass through with the actor attached.
    const read = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).config.model.effective, "m-in");
    const write = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m-in", budgetMinutes: 12 }),
    });
    assert.equal(write.status, 200);
    assert.deepEqual(seen, [
      { method: "GET", actor: "deployer@x.test" },
      { method: "PUT", actor: "deployer@x.test", body: { model: "m-in", budgetMinutes: 12 } },
    ]);
    // Anonymous stays out at the console gate.
    assert.equal((await fetch(url)).status, 401);
  } finally {
    await new Promise((r) => srv.close(r));
    await new Promise((r) => packsSrv.close(r));
  }
});
