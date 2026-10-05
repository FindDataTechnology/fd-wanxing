#!/usr/bin/env node
// ── Logto identity gate tests (⑤ increment 2) ───────────────────────────────
//
//   node --test scripts/test-wanxing-logto.mjs
//
// ES384 ID-token verification against a stubbed JWKS (real crypto: a generated
// P-384 key signs the stub tokens), issuer/audience/expiry/refusal paths, the
// email allowlist fail-close, the dual gate through registerWanxingRoutes, the
// session refresh/revoke proxies, and the identity-gated fleet forwarding
// (add-console-session-continuity).

import assert from "node:assert/strict";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { test } from "node:test";

const { createLogtoAuth } = await import("../services/wanxing-facade/logto-auth.js");
const { registerWanxingRoutes } = await import("../services/wanxing-facade/routes.js");

const tmp = mkdtempSync(path.join(tmpdir(), "wx-logto-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

// A P-384 signer playing the tenant OP.
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "k1";
jwk.alg = "ES384";
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
// Sign JWS-style: strip the DER wrapper node produces and emit raw R||S —
// exactly what a real OP sends (the facade converts back for node's verify).
const rawRS = (der) => {
  const lenR = der[3];
  const r = der.slice(4, 4 + lenR);
  const lenS = der[5 + lenR];
  const s = der.slice(6 + lenR, 6 + lenR + lenS);
  const pad48 = (b) => {
    let x = b;
    while (x.length > 1 && x[0] === 0) x = x.slice(1); // DER leading zero
    return Buffer.concat([Buffer.alloc(Math.max(0, 48 - x.length)), x]);
  };
  return Buffer.concat([pad48(r), pad48(s)]);
};
const sign = (payload) => {
  const h = b64u(JSON.stringify({ alg: "ES384", typ: "JWT", kid: "k1" }));
  const p = b64u(JSON.stringify(payload));
  const sig = rawRS(nodeSign("sha384", Buffer.from(`${h}.${p}`), privateKey));
  return `${h}.${p}.${b64u(sig)}`;
};

const fetchImpl = async (url, init = {}) => {
  if (String(url).endsWith("/oidc/jwks")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
  }
  return new Response("{}", { status: 404 });
};

const EP = "https://auth.example.test";
const APP = "app-123";
const make = (over = {}) =>
  createLogtoAuth({ endpoint: EP, appId: APP, allowlist: "ops@x.test, dev@x.test", fetchImpl, ...over });

const claims = (over = {}) => ({
  iss: `${EP}/oidc`,
  aud: APP,
  exp: Math.floor(Date.now() / 1000) + 600,
  sub: "u1",
  email: "ops@x.test",
  ...over,
});

test("logto: verifies a good ES384 ID token; refuses bad iss/aud/exp/allowlist", async () => {
  const a = make();
  assert.deepEqual(await a.verifyIdToken(sign(claims())), { email: "ops@x.test", sub: "u1" });
  assert.equal(await a.verifyIdToken(sign(claims({ iss: "https://evil/" }))), null);
  assert.equal(await a.verifyIdToken(sign(claims({ aud: "other" }))), null);
  assert.equal(await a.verifyIdToken(sign(claims({ exp: 1 }))), null);
  // allowlist miss now throws with diagnostics (the operator must see who knocked)
  await assert.rejects(() => a.verifyIdToken(sign(claims({ email: "nobody@x.test" }))), /identity refused/);
  assert.equal(await a.verifyIdToken("garbage"), null);
  // unconfigured / empty allowlist = identity gate fully closed
  assert.equal(make({ allowlist: "" }).configured, false);
});

test("logto: dual gate through the facade — ID token opens the console routes", async () => {
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (_q, res) => res.json({ deployments: [] }));
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));
  const env = {
    PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
    AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
    AGENT_SERVING_REGISTRY_TOKEN: "svc",
    FLEET_OBSERVER_TOKEN: "svc-tok",
    WANXING_LOGTO_ENDPOINT: EP,
    WANXING_LOGTO_APP_ID: APP,
    WANXING_CONSOLE_ALLOWLIST: "ops@x.test",
  };
  const app = express();
  const wired = registerWanxingRoutes(app, {
    dataRoot: path.join(tmp, `d-${Math.random().toString(36).slice(2)}`),
    env,
    fetchImpl: async (url, init = {}) => {
      if (String(url).startsWith("http://127.0.0.1:")) return fetch(url, init);
      if (String(url).endsWith("/oidc/jwks")) {
        return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    },
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/wanxing/v1/console/deployments`)).status, 401);
    const good = await fetch(`${base}/api/wanxing/v1/console/deployments`, {
      headers: { Authorization: `Bearer ${sign(claims())}` },
    });
    assert.equal(good.status, 200);
    const bad = await fetch(`${base}/api/wanxing/v1/console/deployments`, {
      headers: { Authorization: `Bearer ${sign(claims({ email: "nobody@x.test" }))}` },
    });
    assert.equal(bad.status, 401); // gate translates the diag throw into a plain 401
    // auth config surfaces for the static face
    const cfg = await (await fetch(`${base}/api/wanxing/v1/console/auth/config`)).json();
    assert.deepEqual(cfg, { configured: true, app_id: APP, endpoint: EP });
  } finally {
    wired.close();
    await new Promise((r) => srv.close(r));
    await new Promise((r) => packsSrv.close(r));
  }
});

// Shared OP stub for the session tests: JWKS + token (refresh grant) +
// revocation endpoints. `dead` is an invalid grant; every other refresh token
// rotates to `rotated-2` with a fresh allowlisted id_token. `refuse` rotates
// to a token the allowlist must reject.
const opFetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith("/oidc/jwks")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
  }
  if (u.endsWith("/oidc/token")) {
    const body = new URLSearchParams(init.body ?? "");
    if (body.get("grant_type") === "authorization_code") {
      if (body.get("code") === "dead-code") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      return new Response(
        JSON.stringify({ id_token: sign(claims()), refresh_token: "seed-1", token_type: "Bearer", expires_in: 3600 }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.get("grant_type") !== "refresh_token") return new Response("{}", { status: 404 });
    const rt = body.get("refresh_token");
    if (rt === "dead") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    const email = rt === "refuse" ? "nobody@x.test" : "ops@x.test";
    return new Response(
      JSON.stringify({ id_token: sign(claims({ email })), refresh_token: "rotated-2", token_type: "Bearer", expires_in: 3600 }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (u.endsWith("/oidc/token/revocation")) {
    const body = new URLSearchParams(init.body ?? "");
    if (body.get("token") === "tenant-down") return new Response("{}", { status: 503 });
    return new Response("{}");
  }
  return new Response("{}", { status: 404 });
};

test("logto: refreshGrant rotates and revokeToken posts client_id", async () => {
  const a = make({ fetchImpl: opFetch });
  // exchangeCode passes the seed refresh token through (the 2026-10-06 live
  // finding: it silently dropped doc.refresh_token and the console never
  // gained a renewal credential).
  const ex = await a.exchangeCode({ code: "good-code", verifier: "v", redirectUri: "https://wanxing.test/console-callback" });
  assert.equal(ex.refresh_token, "seed-1");
  assert.equal(ex.email, "ops@x.test");
  const doc = await a.refreshGrant({ refreshToken: "live" });
  assert.equal(doc.refresh_token, "rotated-2");
  assert.ok(doc.id_token.split(".").length === 3);
  await assert.rejects(() => a.refreshGrant({ refreshToken: "dead" }), /invalid_grant|token endpoint 400/);
  await a.revokeToken("tok-1"); // 200 path
  // upstream 503: the primitive throws (diagnostics); the route swallows — covered below
  await assert.rejects(() => a.revokeToken("tenant-down"), /revocation endpoint 503/);
  await assert.rejects(() => make({ fetchImpl: opFetch, allowlist: "" }).revokeToken("x"), /not configured/);
});

test("console session routes: refresh re-verifies, revoke is best-effort, unconfigured 503", async () => {
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (_q, res) => res.json({ deployments: [] }));
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));
  const env = {
    PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
    AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
    AGENT_SERVING_REGISTRY_TOKEN: "svc",
    WANXING_LOGTO_ENDPOINT: EP,
    WANXING_LOGTO_APP_ID: APP,
    WANXING_CONSOLE_ALLOWLIST: "ops@x.test",
  };
  const app = express();
  const wired = registerWanxingRoutes(app, {
    dataRoot: path.join(tmp, `d-${Math.random().toString(36).slice(2)}`),
    env,
    fetchImpl: async (url, init = {}) => {
      if (String(url).startsWith("http://127.0.0.1:")) return fetch(url, init);
      return opFetch(url, init);
    },
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, body) =>
    fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  try {
    assert.equal((await post("/api/wanxing/v1/console/auth/refresh", {})).status, 400);
    const ok = await (await post("/api/wanxing/v1/console/auth/refresh", { refresh_token: "live" })).json();
    assert.equal(ok.email, "ops@x.test");
    assert.equal(ok.refresh_token, "rotated-2");
    assert.ok(ok.id_token.split(".").length === 3);
    assert.equal((await post("/api/wanxing/v1/console/auth/refresh", { refresh_token: "dead" })).status, 502);
    assert.equal((await post("/api/wanxing/v1/console/auth/refresh", { refresh_token: "refuse" })).status, 403); // rotation never lowers the gate
    assert.deepEqual(await (await post("/api/wanxing/v1/console/auth/revoke", { token: "t" })).json(), { ok: true });
    assert.equal((await post("/api/wanxing/v1/console/auth/revoke", {})).status, 400);
    assert.equal((await post("/api/wanxing/v1/console/auth/revoke", { token: "tenant-down" })).status, 200); // cleanup, never a gate

    // Unconfigured deployment: the whole identity face 503s (and no config route).
    const app2 = express();
    const wired2 = registerWanxingRoutes(app2, {
      dataRoot: path.join(tmp, `d-${Math.random().toString(36).slice(2)}`),
      env: { ...env, WANXING_LOGTO_ENDPOINT: "", WANXING_LOGTO_APP_ID: "", WANXING_CONSOLE_ALLOWLIST: "" },
      fetchImpl: opFetch,
    });
    const srv2 = http.createServer(app2).listen(0);
    await new Promise((r) => srv2.once("listening", r));
    const base2 = `http://127.0.0.1:${srv2.address().port}`;
    try {
      assert.equal((await post2(base2, "/api/wanxing/v1/console/auth/refresh", { refresh_token: "live" })).status, 503);
      assert.equal((await post2(base2, "/api/wanxing/v1/console/auth/revoke", { token: "t" })).status, 503);
      assert.equal((await fetch(`${base2}/api/wanxing/v1/console/auth/config`)).status, 404);
    } finally {
      wired2.close();
      await new Promise((r) => srv2.close(r));
    }
  } finally {
    wired.close();
    await new Promise((r) => srv.close(r));
    await new Promise((r) => packsSrv.close(r));
  }
});
const post2 = (base, p, body) =>
  fetch(`${base}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

test("fleet reads ride the console gate: identity or service token in, observer credential out", async () => {
  let observerHits = 0;
  const obsApp = express();
  obsApp.get("/api/fleet/v1/board", (req, res) => {
    observerHits += 1;
    if (req.headers.authorization !== "Bearer obs-tok") return res.status(401).json({ error: "fleet service credential required" });
    res.json({ agents_total: 3, runners: {} });
  });
  obsApp.get("/api/fleet/v1/agents/:slug/timeline", (req, res) =>
    res.json({ events: [{ id: "e1", slug: req.params.slug, limit: req.query.limit ?? null }] }),
  );
  const obsSrv = http.createServer(obsApp).listen(0);
  await new Promise((r) => obsSrv.once("listening", r));
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (_q, res) => res.json({ deployments: [] }));
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));
  const env = {
    PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
    AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
    AGENT_SERVING_REGISTRY_TOKEN: "svc",
    FLEET_OBSERVER_URL: `http://127.0.0.1:${obsSrv.address().port}`,
    FLEET_OBSERVER_TOKEN: "obs-tok",
    WANXING_LOGTO_ENDPOINT: EP,
    WANXING_LOGTO_APP_ID: APP,
    WANXING_CONSOLE_ALLOWLIST: "ops@x.test",
  };
  const app = express();
  const wired = registerWanxingRoutes(app, {
    dataRoot: path.join(tmp, `d-${Math.random().toString(36).slice(2)}`),
    env,
    fetchImpl: async (url, init = {}) => {
      if (String(url).startsWith("http://127.0.0.1:")) return fetch(url, init);
      return opFetch(url, init);
    },
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const hits0 = observerHits;
    // Neither credential → refused at the facade; the observer is never contacted.
    assert.equal((await fetch(`${base}/api/fleet/v1/board`)).status, 401);
    assert.equal(observerHits, hits0);
    // A verified identity reads the board; the observer saw the service credential.
    const board = await fetch(`${base}/api/fleet/v1/board`, { headers: { Authorization: `Bearer ${sign(claims())}` } });
    assert.equal(board.status, 200);
    assert.equal((await board.json()).agents_total, 3);
    // The ops service token still opens the same door.
    const svc = await fetch(`${base}/api/fleet/v1/board`, { headers: { Authorization: "Bearer obs-tok" } });
    assert.equal(svc.status, 200);
    // Timeline with query passthrough.
    const tl = await (
      await fetch(`${base}/api/fleet/v1/agents/packs-x-agent/timeline?limit=50`, {
        headers: { Authorization: `Bearer ${sign(claims())}` },
      })
    ).json();
    assert.equal(tl.events[0].slug, "packs-x-agent");
    assert.equal(tl.events[0].limit, "50");
    // Observer down → 502 diagnostic, never the observer's own credential challenge.
    await new Promise((r) => obsSrv.close(r));
    const down = await fetch(`${base}/api/fleet/v1/board`, { headers: { Authorization: `Bearer ${sign(claims())}` } });
    assert.equal(down.status, 502);
    assert.match((await down.json()).error, /fleet observer unavailable/);
  } finally {
    wired.close();
    await new Promise((r) => srv.close(r));
    await new Promise((r) => packsSrv.close(r));
  }
});
