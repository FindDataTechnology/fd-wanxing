#!/usr/bin/env node
// ── Logto identity gate tests (⑤ increment 2) ───────────────────────────────
//
//   node --test scripts/test-wanxing-logto.mjs
//
// ES384 ID-token verification against a stubbed JWKS (real crypto: a generated
// P-384 key signs the stub tokens), issuer/audience/expiry/refusal paths, the
// email allowlist fail-close, and the dual gate through registerWanxingRoutes.

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
const sign = (payload) => {
  const h = b64u(JSON.stringify({ alg: "ES384", typ: "JWT", kid: "k1" }));
  const p = b64u(JSON.stringify(payload));
  const sig = nodeSign("sha384", Buffer.from(`${h}.${p}`), privateKey);
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
