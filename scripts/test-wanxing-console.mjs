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

// ── fleet-ownership-gates: scoped list, non-deployer refusals, ops full view ─

test("fleet ownership gates: list scoping, non-deployer 403s, deployer round-trip, ops unaffected", async () => {
  const ownRows = [
    { packId: "POW", agentId: "alpha", version: 1, agentPath: "/packs/POW/deployments/alpha", deployedBy: "owner@x.test" },
    { packId: "POT", agentId: "beta", version: 1, agentPath: "/packs/POT/deployments/beta", deployedBy: "Other@X.Test" },
    { packId: "POD", agentId: "legacy", version: 1, agentPath: "/packs/POD/deployments/legacy" },
  ];
  const ownSlug = slugFor(ownRows[0].agentPath);

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
  const sign = (email) => {
    const h = b64u(JSON.stringify({ alg: "ES384", typ: "JWT", kid: "k1" }));
    const p = b64u(JSON.stringify({
      iss: "https://auth.example.test/oidc", aud: "app-own", exp: Math.floor(Date.now() / 1000) + 600,
      sub: `u-${email}`, email,
    }));
    const sig = rawRS(nodeSign("sha384", Buffer.from(`${h}.${p}`), privateKey));
    return `${h}.${p}.${b64u(sig)}`;
  };
  const asOwner = { Authorization: `Bearer ${sign("owner@x.test")}` };
  const asRival = { Authorization: `Bearer ${sign("rival@x.test")}` };

  const writes = [];
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (req, res) => {
    if (req.headers.authorization !== "Bearer svc") return res.status(401).json({});
    res.json({ deployments: ownRows });
  });
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));

  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith("/oidc/jwks")) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
    if (url.startsWith("http://127.0.0.1:")) return fetch(url, init);
    if (url.startsWith("https://reg.internal/api/agents/packs/POW")) {
      if (init.method === "PUT") writes.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ name: "A", visibility: "public", metadata: {} }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };
  const app = express();
  const wired = registerWanxingRoutes(app, {
    dataRoot: path.join(tmp, `own-${Math.random().toString(36).slice(2)}`),
    env: {
      PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
      AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
      AGENT_SERVING_REGISTRY_TOKEN: "svc",
      FLEET_OBSERVER_TOKEN: TOKEN,
      WANXING_LOGTO_ENDPOINT: "https://auth.example.test",
      WANXING_LOGTO_APP_ID: "app-own",
      WANXING_CONSOLE_ALLOWLIST: "owner@x.test,rival@x.test",
    },
    fetchImpl,
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const dep = `${base}/api/wanxing/v1/console/deployments`;
  try {
    // Scoping: the verified identity sees only its own row (case-insensitive
    // deployedBy match); rows without a deployer never surface to identities.
    const mine = (await (await fetch(dep, { headers: asOwner })).json()).deployments;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].slug, ownSlug);
    // Ops keeps the full fleet view, deployer-less rows included.
    const all = (await (await fetch(dep, { headers: H })).json()).deployments;
    assert.equal(all.length, 3);

    // Non-deployer refusals: pause and every allowlist verb 403 with zero
    // side effects on the registry.
    assert.equal((await fetch(`${dep}/${ownSlug}/pause`, { method: "POST", headers: asRival })).status, 403);
    assert.equal((await fetch(`${dep}/${ownSlug}/resume`, { method: "POST", headers: asRival })).status, 403);
    assert.equal((await fetch(`${dep}/${ownSlug}/callers`, { headers: asRival })).status, 403);
    assert.equal((await fetch(`${dep}/${ownSlug}/callers`, {
      method: "POST", headers: { ...asRival, "Content-Type": "application/json" }, body: JSON.stringify({ email: "known@x.test" }),
    })).status, 403);
    assert.equal((await fetch(`${dep}/${ownSlug}/callers`, {
      method: "DELETE", headers: { ...asRival, "Content-Type": "application/json" }, body: JSON.stringify({ userId: 7 }),
    })).status, 403);
    assert.equal(writes.length, 0);

    // Deployer round-trip: pause succeeds and writes registry metadata.
    const p = await fetch(`${dep}/${ownSlug}/pause`, { method: "POST", headers: asOwner });
    assert.equal(p.status, 200);
    assert.equal((await p.json()).paused, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].metadata.paused, true);
    // Deployer allowlist read opens.
    assert.equal((await fetch(`${dep}/${ownSlug}/callers`, { headers: asOwner })).status, 200);

    // Ops credential still acts on any deployment.
    assert.equal((await fetch(`${dep}/${ownSlug}/resume`, { method: "POST", headers: H })).status, 200);
    assert.equal(writes.length, 2);
    assert.equal(writes[1].metadata.paused, undefined);
  } finally {
    wired.close();
    await new Promise((r) => srv.close(r));
    await new Promise((r) => packsSrv.close(r));
  }
});

// ── deployment memory proxy (add-memory-visibility-console) ─────────────────

test("deployment memory: owner passthrough with derived rootKey, rival 403 without forward, unconfigured 503, forget confirm", async () => {
  const memRows = [
    { packId: "MEM1", agentId: "sage", version: 1, agentPath: "/packs/MEM1/deployments/sage", deployedBy: "sage@x.test" },
  ];
  const memSlug = slugFor(memRows[0].agentPath);

  const memCalls = [];
  const memApp = express();
  memApp.get("/memory", (req, res) => {
    memCalls.push({ kind: "read", rootKey: req.query.rootKey, layer: req.query.layer ?? null });
    if (req.headers.authorization !== "Bearer fdm-plat") return res.status(401).json({ error: "unauthorized" });
    res.json({ items: [{ path: "sage/experiences/e1.md", title: "排障经验", layer: "L2", project: "sage", sources: [], ts: "2026-10-23T00:00:00Z" }], offset: 0, limit: 50 });
  });
  memApp.post("/forget", express.json({ limit: "4kb" }), (req, res) => {
    memCalls.push({ kind: "forget", rootKey: req.body?.rootKey, path: req.body?.path, confirm: req.body?.confirm });
    if (req.body?.confirm !== true) return res.status(400).json({ error: "confirm_required" });
    res.json({ forgotten: req.body.path });
  });
  const memSrv = http.createServer(memApp).listen(0);
  await new Promise((r) => memSrv.once("listening", r));

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

  const sign = (email) => {
    const h = b64u(JSON.stringify({ alg: "ES384", typ: "JWT", kid: "k1" }));
    const p = b64u(JSON.stringify({
      iss: "https://auth.example.test/oidc", aud: "app-own", exp: Math.floor(Date.now() / 1000) + 600,
      sub: `u-${email}`, email,
    }));
    return `${h}.${p}.${b64u(rawRS(nodeSign("sha384", Buffer.from(`${h}.${p}`), privateKey)))}`;
  };
  const asSage = { Authorization: `Bearer ${sign("sage@x.test")}`, "Content-Type": "application/json" };
  const asRival = { Authorization: `Bearer ${sign("rival@x.test")}`, "Content-Type": "application/json" };

  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (req, res) => {
    if (req.headers.authorization !== "Bearer svc") return res.status(401).json({});
    res.json({ deployments: memRows });
  });
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));

  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith("/oidc/jwks")) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
    if (url.startsWith("http://127.0.0.1:")) return fetch(url, init);
    return new Response("{}", { status: 404 });
  };
  const app = express();
  const wiredMem = registerWanxingRoutes(app, {
    dataRoot: path.join(tmp, `mem-${Math.random().toString(36).slice(2)}`),
    env: {
      PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
      AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
      AGENT_SERVING_REGISTRY_TOKEN: "svc",
      FLEET_OBSERVER_TOKEN: TOKEN,
      WANXING_LOGTO_ENDPOINT: "https://auth.example.test",
      WANXING_LOGTO_APP_ID: "app-own",
      WANXING_CONSOLE_ALLOWLIST: "sage@x.test,rival@x.test",
      FD_MEMORY_URL: `http://127.0.0.1:${memSrv.address().port}`,
      FD_MEMORY_PLATFORM_TOKEN: "fdm-plat",
    },
    fetchImpl,
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  // owner read: forwarded with the row-derived rootKey, body transparent
  const rd = await fetch(`${base}/api/wanxing/v1/console/deployments/${memSlug}/memory?layer=L2`, { headers: asSage });
  assert.equal(rd.status, 200);
  const doc = await rd.json();
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].layer, "L2");
  const readCall = memCalls.find((c) => c.kind === "read");
  assert.equal(readCall.rootKey, "d-MEM1", "rootKey derives from the verified row");
  assert.equal(readCall.layer, "L2");

  // rival: 403 from the owner gate, ZERO fleet-memory traffic
  const before = memCalls.length;
  const denied = await fetch(`${base}/api/wanxing/v1/console/deployments/${memSlug}/memory`, { headers: asRival });
  assert.equal(denied.status, 403);
  assert.equal(memCalls.length, before, "no forward on refusal");

  // forget without confirm: forwarded, fd-memory refuses 400 (facade does not invent a confirm)
  const nf = await fetch(`${base}/api/wanxing/v1/console/deployments/${memSlug}/memory/forget`, { method: "POST", headers: asSage, body: JSON.stringify({ path: "sage/experiences/e1.md" }) });
  assert.equal(nf.status, 400);
  // forget with confirm: forwarded, ok
  const ok = await fetch(`${base}/api/wanxing/v1/console/deployments/${memSlug}/memory/forget`, { method: "POST", headers: asSage, body: JSON.stringify({ path: "sage/experiences/e1.md", confirm: true }) });
  const okDoc = await ok.json();
  if (!okDoc.forgotten) console.log("forget resp:", ok.status, JSON.stringify(okDoc));
  assert.equal(okDoc.forgotten, "sage/experiences/e1.md");
  const forgetCall = memCalls.find((c) => c.kind === "forget" && c.confirm === true);
  assert.equal(forgetCall.rootKey, "d-MEM1");
  wiredMem.close();
  await new Promise((r) => srv.close(r));
  memSrv.close();
  packsSrv.close();
});

test("deployment memory: unconfigured seam responds 503 MEMORY_LANE_UNCONFIGURED", async () => {
  const rows = [{ packId: "MEM2", agentId: "s2", version: 1, agentPath: "/packs/MEM2/deployments/s2" }];
  const slug2 = slugFor(rows[0].agentPath);
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (req, res) => {
    if (req.headers.authorization !== "Bearer svc") return res.status(401).json({});
    res.json({ deployments: rows });
  });
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));
  const app = express();
  const wiredMemU = registerWanxingRoutes(app, {
    dataRoot: path.join(tmp, `memu-${Math.random().toString(36).slice(2)}`),
    env: {
      PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
      AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
      AGENT_SERVING_REGISTRY_TOKEN: "svc",
      FLEET_OBSERVER_TOKEN: TOKEN,
      // no FD_MEMORY_URL/TOKEN — the seam is unconfigured
    },
    fetchImpl: async (url, init = {}) => {
      if (url.startsWith("http://127.0.0.1:")) return fetch(url, init);
      return new Response("{}", { status: 404 });
    },
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  // warm the bookkeeping snapshot (async refresh after register)
  for (let i = 0; i < 20; i++) {
    const w = await fetch(`${base}/api/wanxing/v1/console/deployments`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const wd = await w.json().catch(() => ({}));
    if (i === 19) console.log("warm list final:", w.status, JSON.stringify(wd).slice(0, 200));
    if ((wd.deployments ?? []).some((d) => d.slug === slug2)) break;
    await new Promise((r2) => setTimeout(r2, 100));
  }
  const r = await fetch(`${base}/api/wanxing/v1/console/deployments/${slug2}/memory`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const udoc = await r.json();
  if (r.status !== 503) console.log("unconfigured resp:", r.status, JSON.stringify(udoc).slice(0, 120));
  assert.equal(r.status, 503);
  assert.equal(udoc.error.code, "MEMORY_LANE_UNCONFIGURED");
  wiredMemU.close();
  await new Promise((r) => srv.close(r));
  packsSrv.close();
});

// ── 3.4 两扇门读同一件事（unify-wanxing-shared-semantics）────────────────────
//
// 暂停只写一个字段 `metadata.paused`，但有两扇门写它：萬星控制台（这里）与壹座
// packs 面的 setAgentPaused。写的那半已经被契约夹具钉住了；这条钉的是**读的那半**：
// 壹座写进 registry 的事实，萬星控制台读面必须认出来，反之亦然——否则就是"一个事实、
// 两张脸、相反答案"，和当初 chatability 那个 bug 同一类。

test("3.4 two doors observe one fact: whatever the registry says, the console read face agrees", async () => {
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (_req, res) => res.json({ deployments: rows }));
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));

  // A registry that REMEMBERS what it was told (the other harness returns a fixed
  // entry, which cannot show that a read face reflects a foreign write).
  let stored = { name: "S", visibility: "public", metadata: { paused: true } }; // ← 壹座已经暂停过
  const writes = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.startsWith("http://127.0.0.1:")) return fetch(url, init);
    if (url.includes("/api/agents")) {
      if (init.method === "PUT" || init.method === "POST") {
        writes.push(JSON.parse(init.body));
        stored = JSON.parse(init.body);
      }
      return new Response(JSON.stringify(stored), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  };

  const app = express();
  const wired = registerWanxingRoutes(app, {
    dataRoot: path.join(tmp, `d-two-door-${Math.random().toString(36).slice(2)}`),
    env: {
      PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
      AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
      AGENT_SERVING_REGISTRY_TOKEN: "svc",
      FLEET_OBSERVER_TOKEN: TOKEN,
    },
    fetchImpl,
    sub2api: { degraded: () => false, async findUserByEmail() { return null; } },
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const listPaused = async () =>
    (await (await fetch(`${base}/api/wanxing/v1/console/deployments`, { headers: H })).json())
      .deployments[0].paused;

  try {
    // 壹座 wrote paused:true → 萬星 reads true, without writing anything itself.
    assert.equal(await listPaused(), true, "a pause written by the other door must be visible here");
    assert.equal(writes.length, 0, "reading must not write");

    // 萬星 resumes → the entry loses the key (not `false`), and both faces agree.
    await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/resume`, { method: "POST", headers: H });
    assert.equal("paused" in stored.metadata, false, "resume must DELETE the key for the other door too");
    assert.equal(await listPaused(), false);

    // 萬星 pauses → the other door now reads the same fact.
    await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/pause`, { method: "POST", headers: H });
    assert.equal(stored.metadata.paused, true, "the written entry is what 壹座 will read");
    assert.equal(await listPaused(), true);
  } finally {
    srv.close();
    packsSrv.close();
    wired.close?.();
  }
});
