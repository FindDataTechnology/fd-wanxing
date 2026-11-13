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
const codeClaims = {};
const opFetch = async (url, init = {}) => {
  const u = String(url);
  if (u.endsWith("/oidc/jwks")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "Content-Type": "application/json" } });
  }
  if (u.endsWith("/oidc/token")) {
    const body = new URLSearchParams(init.body ?? "");
    if (body.get("grant_type") === "authorization_code") {
      if (body.get("code") === "dead-code") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      const special = codeClaims[body.get("code")];
      return new Response(
        JSON.stringify({ id_token: sign(claims(special)), refresh_token: "seed-1", token_type: "Bearer", expires_in: 3600 }),
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

// ── add-agent-chat-lane 2.2: allowlist-off verification (chat lane) ──────────

test("logto: allowlist-off mode admits any tenant identity; the console gate is unchanged", async () => {
  const a = make();
  // A stranger token: refused by the default (console) gate…
  const stranger = sign(claims({ email: "stranger@x.test", sub: "v-42" }));
  await assert.rejects(() => a.verifyIdToken(stranger), /identity refused/);
  // …and admitted by the chat lane's no-allowlist verification.
  assert.deepEqual(await a.verifyIdToken(stranger, { allowlist: false }), { email: "stranger@x.test", sub: "v-42" });
  // An email-less token still identifies a visitor by sub on the chat lane;
  // the console gate keeps refusing it.
  const noEmail = sign(claims({ email: undefined, sub: "v-43" }));
  await assert.rejects(() => a.verifyIdToken(noEmail), /identity refused/);
  assert.deepEqual(await a.verifyIdToken(noEmail, { allowlist: false }), { email: "", sub: "v-43" });
  // Subject-less tokens identify nobody on either lane.
  assert.equal(await a.verifyIdToken(sign(claims({ sub: "" })), { allowlist: false }), null);
  assert.equal(await a.verifyIdToken(sign(claims({ sub: "" }))), null);
  // An allowlisted identity passes both modes identically.
  assert.deepEqual(await a.verifyIdToken(sign(claims()), { allowlist: false }), { email: "ops@x.test", sub: "u1" });
});

// ── add-agent-chat-lane 4.1/4.2: owner-scoped records + host allowance ───────

test("chat-lane console: usage records masked per owner, host allowance deployer-gated", async () => {
  const depRows = [{
    packId: "Pk1", agentId: "agent", version: 1,
    agentPath: "/packs/Pk1/deployments/agent", deployedBy: "ops@x.test",
  }];
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (_q, r) => r.json({ deployments: depRows }));
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));
  const env = {
    PACKS_INTERNAL_BASE_URL: `http://127.0.0.1:${packsSrv.address().port}`,
    AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
    AGENT_SERVING_REGISTRY_TOKEN: "svc",
    FLEET_OBSERVER_TOKEN: "svc-tok",
    WANXING_LOGTO_ENDPOINT: EP,
    WANXING_LOGTO_APP_ID: APP,
    WANXING_CONSOLE_ALLOWLIST: "ops@x.test,dev@x.test",
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
      if (String(url).startsWith("https://reg.internal/api/agents/")) {
        return new Response(JSON.stringify({ name: "S", visibility: "public", metadata: {} }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    },
  });
  const srv = http.createServer(app).listen(0);
  await new Promise((r) => srv.once("listening", r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const ownerTok = { Authorization: `Bearer ${sign(claims())}` }; // ops@x.test = the deployer
  const otherTok = { Authorization: `Bearer ${sign(claims({ email: "dev@x.test", sub: "dev1" }))}` };
  const opsTok = { Authorization: "Bearer svc-tok" };
  const slug = "packs-pk1-deployments-agent";
  try {
    // Seed the ledger: one chat visitor turn + one API caller turn.
    const store = wired.store;
    store.usageInsert({ id: "u1", callerId: 0, callerEmail: "visitor@x.test", agentSlug: slug, idemKey: "", startedAt: Date.now() - 1000, endedAt: Date.now(), durationMs: 60_000, outcome: "ok", minutesBilled: 1, rateUsd: 0.1, settlementStatus: "settled", channel: "chat", settler: "host", visitorSub: "s1" });
    store.usageInsert({ id: "u2", callerId: 7, callerEmail: "keyholder@x.test", agentSlug: slug, idemKey: "k", startedAt: Date.now() - 500, endedAt: Date.now(), durationMs: 60_000, outcome: "ok", minutesBilled: 1, rateUsd: 0.1, settlementStatus: "settled" });

    // Anonymous → 401; allowlisted non-owner → 403.
    assert.equal((await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/usage`)).status, 401);
    assert.equal((await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/usage`, { headers: otherTok })).status, 403);
    assert.equal((await fetch(`${base}/api/wanxing/v1/console/deployments/nope/usage`, { headers: ownerTok })).status, 404);

    // The deployer reads aggregates: visitor masked, API key holder not.
    const doc = await (await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/usage`, { headers: ownerTok })).json();
    assert.equal(doc.byCaller.find((r) => r.channel === "chat").email, "v***@x.test");
    assert.equal(doc.byCaller.find((r) => r.channel === "api").email, "keyholder@x.test");
    assert.equal(doc.activity.length, 2);

    // Ops: masked by default, unmasked only with the explicit opt-in.
    const opsMasked = await (await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/usage`, { headers: opsTok })).json();
    assert.equal(opsMasked.byCaller.find((r) => r.channel === "chat").email, "v***@x.test");
    const opsOpen = await (await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/usage?unmasked=1`, { headers: opsTok })).json();
    assert.equal(opsOpen.byCaller.find((r) => r.channel === "chat").email, "visitor@x.test");
    const ownerOpen = await (await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/usage?unmasked=1`, { headers: ownerTok })).json();
    assert.equal(ownerOpen.byCaller.find((r) => r.channel === "chat").email, "v***@x.test", "unmasked is ops-only");

    // Host allowance: owner sets and adjusts; non-owner refused; ops fallback.
    const put = await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/host-allowance`, {
      method: "PUT", headers: { ...ownerTok, "Content-Type": "application/json" }, body: JSON.stringify({ limitMinutes: 600 }),
    });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).remainingMinutes, 599);
    assert.equal((await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/host-allowance`, {
      method: "PUT", headers: { ...otherTok, "Content-Type": "application/json" }, body: JSON.stringify({ limitMinutes: 1 }),
    })).status, 403);
    assert.equal((await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/host-allowance`, {
      method: "PUT", headers: { ...ownerTok, "Content-Type": "application/json" }, body: JSON.stringify({ limitMinutes: -3 }),
    })).status, 400);
    const opsPut = await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/host-allowance`, {
      method: "PUT", headers: { ...opsTok, "Content-Type": "application/json" }, body: JSON.stringify({ limitMinutes: 5 }),
    });
    assert.equal(opsPut.status, 200);
    const readBack = await (await fetch(`${base}/api/wanxing/v1/console/deployments/${slug}/host-allowance`, { headers: ownerTok })).json();
    assert.deepEqual(
      { limitMinutes: readBack.limitMinutes, remainingMinutes: readBack.remainingMinutes, updatedBy: readBack.updatedBy },
      { limitMinutes: 5, remainingMinutes: 4, updatedBy: "ops" },
    );
  } finally {
    wired.close();
    await new Promise((r) => srv.close(r));
    await new Promise((r) => packsSrv.close(r));
  }
});

// ── add-agent-chat-lane: the chat-gated exchange (visitor login funnel) ──────

test("exchange gate: chat logins admit off-allowlist identities; console keeps refusing", async () => {
  const a = make({ fetchImpl: opFetch });
  // A stranger's authorization code (the OP stub signs whoever we ask):
  // the console gate refuses the exchange, the chat gate admits it.
  codeClaims["code-stranger"] = { email: "stranger@x.test", sub: "v-9" };
  const stranger = { code: "code-stranger", email: "stranger@x.test", sub: "v-9" };
  const consoleTry = await a.exchangeCode({ code: stranger.code, verifier: "v", redirectUri: "https://web/console-callback" }).catch((e) => e.status);
  assert.equal(consoleTry, 403);
  const chatTry = await a.exchangeCode({ code: stranger.code, verifier: "v", redirectUri: "https://web/console-callback", allowlist: false }).catch((e) => e.status);
  assert.notEqual(chatTry, 403);
});

// ── The 0x30 shape trap: never sniff raw-vs-DER from the first byte ──────────
//
// A raw JWS signature is R||S. If R's first byte happens to be 0x30 — the DER
// SEQUENCE tag — a `raw[0] === 0x30` sniff calls the whole 96-byte blob "already
// DER", node's verify fails, and a *valid* login is refused. Probability is
// ~1/256 per login; it showed up as a 1-in-11 flake of the exchange test above
// before it was named (2026-11-13, reproduced 2/300 in a standalone loop).
//
// This test is deterministic: it grinds signatures until it finds one whose R
// starts with 0x30 and asserts the facade still verifies it. On the old sniffing
// code it fails every time; on shape-by-length it passes every time.

test("logto: a raw signature whose R starts with 0x30 still verifies (shape by length, not by tag byte)", async () => {
  // ECDSA is randomized per signature, so re-signing the same claims gives a new
  // R every time — grind until one starts with the DER SEQUENCE tag (0x30).
  let hit = null;
  for (let i = 0; i < 20000 && !hit; i += 1) {
    const token = sign(claims());
    const raw = Buffer.from(token.split(".")[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    assert.equal(raw.length, 96, "a raw P-384 signature is 96 bytes");
    if (raw[0] === 0x30) hit = token;
  }
  assert.ok(hit, "could not produce a raw signature starting with 0x30 — the signer changed shape");
  // On the old `raw[0] === 0x30` sniff this returned null (identity refused:
  // an intermittent 403 on ~1/256 of real logins).
  assert.deepEqual(await make().verifyIdToken(hit), { email: "ops@x.test", sub: "u1" });
  // And the plain path still works for every other signature.
  assert.deepEqual(await make().verifyIdToken(sign(claims())), { email: "ops@x.test", sub: "u1" });
});

// ── Embed audience allowlist (add-embed-copilot-lane 1.2) ─────────────────────
// Product-line SPA clients of the same tenant: their ID tokens open the chat
// lane (host-relayed identity) only when the client is on WANXING_EMBED_AUDIENCES
// AND the caller explicitly opted into embed audiences. The console shape and
// unconfigured instances stay single-audience.

test("embed D3: audience allowlist admits product-line clients on the chat shape only", async () => {
  const a = make({ embedAudiences: "app-lex,app-wire" });
  const lexTok = sign(claims({ aud: "app-lex" }));
  assert.deepEqual(await a.verifyIdToken(lexTok, { allowlist: false, acceptEmbedAudiences: true }), { email: "ops@x.test", sub: "u1" });
  // Same token on the default shape (console): refused — the list never widens the console gate.
  assert.equal(await a.verifyIdToken(lexTok, { allowlist: false }), null);
  assert.equal(await a.verifyIdToken(lexTok), null);
  // Off-list client: refused even on the chat shape.
  assert.equal(await a.verifyIdToken(sign(claims({ aud: "app-unknown" })), { allowlist: false, acceptEmbedAudiences: true }), null);
  // Unconfigured embedAudiences: env 未配时新 aud 拒（回归——行为逐字节同旧）。
  const b = make();
  assert.equal(await b.verifyIdToken(lexTok, { allowlist: false, acceptEmbedAudiences: true }), null);
  // The console client itself still passes on the chat shape (regression).
  assert.deepEqual(await a.verifyIdToken(sign(claims()), { allowlist: false, acceptEmbedAudiences: true }), { email: "ops@x.test", sub: "u1" });
});
