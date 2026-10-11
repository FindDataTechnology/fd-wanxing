#!/usr/bin/env node
// ── Deployer self-service tests (add-deployer-self-service 1.1–3.1) ────────
//
// The M3 slice-① face: the facet forwarding channel (configured vs visibly
// degraded), author-scoped pack listing, ownership-checked deploy forwarding
// with billing-key requirement and verbatim error passthrough, and the share
// card assembly (chat URL + chatability verdict + allowance).
//
//   node --test scripts/test-wanxing-selfservice.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { test } from "node:test";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-selfsvc-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createSelfServiceFace } = await import("../services/wanxing-facade/selfservice.js");

const OPS_TOKEN = "ops-secret";
const DEPLOYER_TOKEN = "deployer-id-token";
const DEPLOYER = "creator@finddata.tech";

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

// A stub facet: browse/detail/deploy over the forwarded identity, recording
// the x-facet-user header so the tests prove identity forwarding.
function stubFacet({ packs = [], deployReply = null } = {}) {
  const seen = [];
  const app = express();
  app.use(express.json());
  app.get("/api/packs", (req, res) => {
    seen.push({ path: "/api/packs", user: req.headers["x-facet-user"], token: req.headers["x-facet-token"] ? "present" : "absent" });
    res.json({ packs: packs.filter((p) => req.query.includeUnlisted || !p.unlisted) });
  });
  app.get("/api/packs/:id", (req, res) => {
    const p = packs.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Pack not found" });
    res.json(p);
  });
  app.post("/api/packs/:id/versions/:v/deploy", (req, res) => {
    seen.push({ path: "/deploy", body: req.body, user: req.headers["x-facet-user"] });
    if (deployReply) return res.status(deployReply.status).json(deployReply.body);
    res.json({ deployed: [{ agentId: "chat-agent", agentPath: "/packs/p1/chat-agent" }] });
  });
  const server = http.createServer(app).listen(0);
  return {
    server,
    seen,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

function harness({ facet, channel = true, subsidyOpen = () => false } = {}) {
  const store = freshStore();
  const env = channel
    ? { FACET_BASE_URL: facet.base, FACET_INTERNAL_TOKEN: "fit-secret", WANXING_WEB_BASE_URL: "https://wanxing.example" }
    : {};
  const face = createSelfServiceFace({
    store,
    logtoAuth: { configured: true, verifyIdToken: async (t) => (t === DEPLOYER_TOKEN ? { email: DEPLOYER } : null) },
    requireToken: (req) => String(req.headers.authorization || "") === `Bearer ${OPS_TOKEN}`,
    env,
    fetchImpl: fetch,
    subsidyOpen,
    log: () => {},
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, opts = {}) => {
    const r = await fetch(base + p, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const asDeployer = (p, opts = {}) => call(p, { ...opts, headers: { Authorization: `Bearer ${DEPLOYER_TOKEN}`, ...(opts.headers ?? {}) } });
  return { store, face, base, call, asDeployer, close: () => new Promise((r) => server.close(() => r())) };
}

const pack = (over = {}) => ({
  id: "p1",
  authorEmail: DEPLOYER,
  name: "聊天小助手",
  version: 3,
  visibility: "public",
  unlisted: false,
  publishedAt: 1,
  manifest: { agents: [{ id: "chat-agent", name: "小助手", serving: { protocol: "a2a" } }] },
  ...over,
});

test("1.1 the channel degrades visibly when unconfigured; identity forwards when it is", async () => {
  const facet = await stubFacet({ packs: [pack()] });
  const h = await harness({ facet, channel: false });
  try {
    const down = await h.asDeployer("/api/wanxing/v1/console/my/packs");
    assert.equal(down.status, 503);
    assert.match(down.body.error, /FACET_BASE_URL/);

    const h2 = await harness({ facet, channel: true });
    const up = await h2.asDeployer("/api/wanxing/v1/console/my/packs");
    assert.equal(up.status, 200);
    // The facet saw the deployer's identity, not a service identity.
    const fwd = JSON.parse(Buffer.from(facet.seen[0].user, "base64url").toString());
    assert.equal(fwd.email, DEPLOYER);
    assert.equal(facet.seen[0].token, "present");
    await h2.close();
  } finally {
    await h.close();
    await facet.close();
  }
});

test("1.1 my/packs filters by author and marks deployability; empty reads as []", async () => {
  const facet = await stubFacet({ packs: [pack(), pack({ id: "p2", authorEmail: "someone-else@x.y" }), pack({ id: "p3", manifest: { agents: [{ id: "a", name: "b" }] } })] });
  const h = await harness({ facet });
  try {
    const r = await h.asDeployer("/api/wanxing/v1/console/my/packs");
    assert.equal(r.status, 200);
    assert.equal(r.body.packs.length, 2); // p2 (foreign) excluded
    const byId = Object.fromEntries(r.body.packs.map((p) => [p.id, p]));
    assert.equal(byId.p1.deployable, true);
    assert.deepEqual(byId.p1.deployableAgents.map((a) => a.id), ["chat-agent"]);
    assert.equal(byId.p3.deployable, false); // no serving contract
    assert.equal(byId.p3.deployableAgents.length, 0);
  } finally {
    await h.close();
    await facet.close();
  }
});

test("2.1 deploy: billing key required, foreign pack 404, facet refusals pass through, success maps slugs", async () => {
  const facet = await stubFacet({ packs: [pack(), pack({ id: "p9", authorEmail: "other@x.y" })] });
  const h = await harness({ facet });
  try {
    const noKey = await h.asDeployer("/api/wanxing/v1/console/my/packs/p1/deploy", { method: "POST", body: JSON.stringify({}) });
    assert.equal(noKey.status, 400);
    assert.match(noKey.body.error, /billingKey/);

    const foreign = await h.asDeployer("/api/wanxing/v1/console/my/packs/p9/deploy", { method: "POST", body: JSON.stringify({ billingKey: "sk-x" }) });
    assert.equal(foreign.status, 404);
    assert.equal(facet.seen.filter((s) => s.path === "/deploy").length, 0); // never forwarded

    const r = await h.asDeployer("/api/wanxing/v1/console/my/packs/p1/deploy", { method: "POST", body: JSON.stringify({ billingKey: "sk-good" }) });
    assert.equal(r.status, 200);
    assert.equal(r.body.deployed[0].slug, "packs-p1-chat-agent");
    assert.equal(r.body.version, 3); // latest as default
    const fwdBody = facet.seen.find((s) => s.path === "/deploy").body;
    assert.equal(fwdBody.billingKeys["chat-agent"], "sk-good");
  } finally {
    await h.close();
    await facet.close();
  }
});

test("2.1 facet's structured refusal reaches the deployer verbatim", async () => {
  const facet = await stubFacet({
    packs: [pack()],
    deployReply: { status: 402, body: { error: { code: "BALANCE_GATE", message: "billing key has no balance" } } },
  });
  const h = await harness({ facet });
  try {
    const r = await h.asDeployer("/api/wanxing/v1/console/my/packs/p1/deploy", { method: "POST", body: JSON.stringify({ billingKey: "sk-broke" }) });
    assert.equal(r.status, 402);
    assert.equal(r.body.error.code, "BALANCE_GATE");
  } finally {
    await h.close();
    await facet.close();
  }
});

test("3.1 the share card assembles URL, chatability, and allowance", async () => {
  const facet = await stubFacet({ packs: [pack()] });
  const h = await harness({ facet, subsidyOpen: () => false });
  try {
    const bare = await h.asDeployer("/api/wanxing/v1/console/my/deployments/packs-p1-chat-agent/share");
    assert.equal(bare.status, 200);
    assert.equal(bare.body.chatUrl, "https://wanxing.example/#/chat/packs-p1-chat-agent");
    assert.equal(bare.body.chatable, false); // no subsidy, no allowance
    assert.match(bare.body.chatableReason, /额度/);
    assert.equal(bare.body.allowance, null);

    h.store.hostAllowanceSet("packs-p1-chat-agent", 60, "ops");
    const withCap = await h.asDeployer("/api/wanxing/v1/console/my/deployments/packs-p1-chat-agent/share");
    assert.equal(withCap.body.chatable, true);
    assert.equal(withCap.body.allowance.remainingMinutes, 60);
    assert.match(withCap.body.chatableReason, /60/);
  } finally {
    await h.close();
    await facet.close();
  }
});

// ── add-deployer-revenue-share: the earnings view (task 3.1) ────────────────
//
// Identity-scoped rows + totals for the verified deployer; ops refused (no
// attributable identity); no billing account reads as honestly empty; a
// billing-plane outage is an explicit 502, never a silent empty list.

test("3.1 my/earnings: rows and totals for the deployer; ops refused; no-account empty; outage 502", async () => {
  const facet = await stubFacet({ packs: [pack()] });
  const sub2api = {
    degraded: () => false,
    findUserByEmail: async (mail) => (mail === DEPLOYER ? { userId: 42, email: mail } : null),
  };
  const store = freshStore();
  const face = createSelfServiceFace({
    store,
    sub2api,
    logtoAuth: { configured: true, verifyIdToken: async (t) => (t === DEPLOYER_TOKEN ? { email: DEPLOYER } : null) },
    requireToken: (req) => String(req.headers.authorization || "") === `Bearer ${OPS_TOKEN}`,
    env: { FACET_BASE_URL: facet.base, FACET_INTERNAL_TOKEN: "fit-secret" },
    fetchImpl: fetch,
    log: () => {},
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, headers = {}) => (await fetch(base + p, { headers })).json();
  try {
    // Seeded ledger for the deployer's user id.
    store.earningsInsertOrIgnore({ usageId: "wu_1", deployerUserId: 42, deployerEmail: DEPLOYER, agentSlug: "packs-p1-chat-agent", revenueUsd: 0.2, amountUsd: 0.14, commission: 0.3 });
    store.earningsMarkSettled("wu_1");
    store.earningsInsertOrIgnore({ usageId: "wu_2", deployerUserId: 42, deployerEmail: DEPLOYER, agentSlug: "packs-p1-chat-agent", revenueUsd: 0.1, amountUsd: 0.07, commission: 0.3 });
    store.earningsInsertOrIgnore({ usageId: "wu_3", deployerUserId: 7, deployerEmail: "other@x", agentSlug: "packs-p1-chat-agent", revenueUsd: 0.1, amountUsd: 0.07, commission: 0.3 });

    const ops = await fetch(base + "/api/wanxing/v1/console/my/earnings", { headers: { Authorization: `Bearer ${OPS_TOKEN}` } });
    assert.equal(ops.status, 403, "ops carries no attributable identity");

    const r = await fetch(base + "/api/wanxing/v1/console/my/earnings", { headers: { Authorization: `Bearer ${DEPLOYER_TOKEN}` } });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.rows.length, 2, "only the deployer's rows");
    assert.equal(d.rows[0].usageId, "wu_2", "newest first");
    assert.deepEqual(d.totals, { settledUsd: 0.14, pendingUsd: 0.07, turns: 2 });

    // No sub2api account for this identity: honestly empty, still 200.
    sub2api.findUserByEmail = async () => null;
    const r2 = await fetch(base + "/api/wanxing/v1/console/my/earnings", { headers: { Authorization: `Bearer ${DEPLOYER_TOKEN}` } });
    assert.equal(r2.status, 200);
    assert.deepEqual((await r2.json()).totals, { settledUsd: 0, pendingUsd: 0, turns: 0 });

    // Billing plane outage: explicit 502.
    sub2api.findUserByEmail = async () => { throw new Error("connection refused"); };
    const r3 = await fetch(base + "/api/wanxing/v1/console/my/earnings", { headers: { Authorization: `Bearer ${DEPLOYER_TOKEN}` } });
    assert.equal(r3.status, 502);
  } finally {
    await new Promise((r) => server.close(() => r()));
    await facet.close();
    store.close();
  }
});
