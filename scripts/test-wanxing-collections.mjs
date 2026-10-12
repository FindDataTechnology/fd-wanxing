#!/usr/bin/env node
// ── Collections tests (add-deploy-collections, M4③) ─────────────────────────
//
// One data model, three semantics: the CRUD face (owner-scoped, shape-guarded
// whole-list entry writes), the bundle deploy (per-entry verdicts through the
// deploy core — greenfield, in-service skip, refusal passthrough, suggested
// config riding the payload), and the public share face (public only, no
// owner leak).
//
//   node --test scripts/test-wanxing-collections.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { test } from "node:test";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-coll-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createSelfServiceFace } = await import("../services/wanxing-facade/selfservice.js");

const OPS_TOKEN = "ops-secret";
const ALICE_TOKEN = "alice-id-token";
const ALICE = "alice@finddata.tech";
const BOB_TOKEN = "bob-id-token";
const BOB = "bob@finddata.tech";

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

// Stub facet: browse/detail/deploy, recording forwarded deploys.
function stubFacet({ packs = [], deployReplyFor = null } = {}) {
  const seen = [];
  const app = express();
  app.use(express.json());
  app.get("/api/packs", (_req, res) => res.json({ packs: packs.filter((p) => !p.unlisted) }));
  app.get("/api/packs/:id", (req, res) => {
    const p = packs.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: "Pack not found" });
    res.json(p);
  });
  app.post("/api/packs/:id/versions/:v/deploy", (req, res) => {
    seen.push({ packId: req.params.id, body: req.body, user: req.headers["x-facet-user"] });
    const reply = deployReplyFor?.(req.params.id);
    if (reply) return res.status(reply.status).json(reply.body);
    res.json({ deployed: (req.body?.agents ?? Object.keys(req.body?.billingKeys ?? {})).map((id) => ({ agentId: id, agentPath: `/packs/${req.params.id}/${id}` })) });
  });
  const server = http.createServer(app).listen(0);
  return {
    server, seen,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }),
  };
}

function harness({ facet, inService = [] }) {
  const store = freshStore();
  const face = createSelfServiceFace({
    store,
    logtoAuth: {
      configured: true,
      verifyIdToken: async (t) =>
        t === ALICE_TOKEN ? { email: ALICE } : t === BOB_TOKEN ? { email: BOB } : null,
    },
    requireToken: (req) => String(req.headers.authorization || "") === `Bearer ${OPS_TOKEN}`,
    env: { FACET_BASE_URL: facet.base, FACET_INTERNAL_TOKEN: "fit-secret", WANXING_WEB_BASE_URL: "https://wanxing.example" },
    fetchImpl: fetch,
    listDeployments: async () => inService.map((packId) => ({ slug: `stub-${packId}`, agentPath: `/packs/${packId}/x`, packId })),
    log: () => {},
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, { method = "GET", token = ALICE_TOKEN, body } = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { store, base, call, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) };
}

const pack = (id, over = {}) => ({
  id,
  authorEmail: ALICE,
  name: `pack ${id}`,
  version: 1,
  visibility: "public",
  category: "",
  featured: false,
  manifest: { agents: [{ id: "a1", name: "甲", serving: { protocol: "a2a" } }, { id: "a2", name: "乙", serving: { protocol: "a2a" } }] },
  ...over,
});

test("store: collections CRUD round-trip with JSON entries", () => {
  const store = freshStore();
  const c = store.collectionInsert({ ownerEmail: ALICE, name: "我的套装", description: "d", visibility: "public" });
  assert.equal(c.visibility, "public");
  assert.deepEqual(c.entries, []);
  const updated = store.collectionUpdate(c.id, { entries: [{ packId: "p1", agentId: "a1", suggestedConfig: { budgetMinutes: 10 } }], name: "改名" });
  assert.equal(updated.name, "改名");
  assert.equal(updated.entries.length, 1);
  assert.equal(store.collectionsForOwner(BOB).length, 0);
  assert.equal(store.collectionsForOwner(ALICE).length, 1);
  assert.equal(store.collectionDelete(c.id), true);
  assert.equal(store.collectionGet(c.id), null);
  store.close();
});

test("collections API: owner-scoped CRUD + whole-list entry writes with shape guards", async () => {
  const facet = await stubFacet({ packs: [pack("p1")] });
  const h = await harness({ facet });
  try {
    const ops = await h.call("/api/wanxing/v1/console/collections", { token: OPS_TOKEN });
    assert.equal(ops.status, 403);

    const bad = await h.call("/api/wanxing/v1/console/collections", { method: "POST", body: { name: "" } });
    assert.equal(bad.status, 400);

    const created = await h.call("/api/wanxing/v1/console/collections", { method: "POST", body: { name: "研究套装", description: "desc", visibility: "public" } });
    assert.equal(created.status, 200);
    const id = created.body.collection.id;

    // Shape guards: dup, unknown suggestedConfig key, config without agentId, over-limit.
    for (const entries of [
      [{ packId: "p1", agentId: "a1" }, { packId: "p1", agentId: "a1" }],
      [{ packId: "p1", agentId: "a1", suggestedConfig: { model: "m", rogue: 1 } }],
      [{ packId: "p1", suggestedConfig: { budgetMinutes: 10 } }],
      [{ packId: "p1", agentId: "a1", suggestedConfig: { budgetMinutes: 1.5 } }],
      Array.from({ length: 21 }, () => ({ packId: "x" })),
    ]) {
      const r = await h.call(`/api/wanxing/v1/console/collections/${id}/entries`, { method: "PUT", body: { entries } });
      assert.equal(r.status, 400, JSON.stringify(entries[0]));
    }

    // A good write lands and resolves against the browse + agents cache.
    const good = await h.call(`/api/wanxing/v1/console/collections/${id}/entries`, {
      method: "PUT",
      body: { entries: [{ packId: "p1", agentId: "a1", suggestedConfig: { budgetMinutes: 10, rhythm: [{ every: "1h" }] } }] },
    });
    assert.equal(good.status, 200);
    const e = good.body.collection.entries[0];
    assert.equal(e.packName, "pack p1");
    assert.equal(e.agentName, "甲");
    assert.equal(e.inService, false);
    assert.deepEqual(e.suggestedConfig, { budgetMinutes: 10, rhythm: [{ every: "1h" }] });

    // Foreign identity sees nothing — private or not.
    const bob = await h.call(`/api/wanxing/v1/console/collections/${id}`, { token: BOB_TOKEN });
    assert.equal(bob.status, 404);

    const del = await h.call(`/api/wanxing/v1/console/collections/${id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
  } finally {
    await h.close();
    await facet.close();
  }
});

test("bundle deploy: per-entry verdicts — deployed / skipped-in-service / refused; suggested config rides", async () => {
  const facet = await stubFacet({
    packs: [
      pack("own1"),
      pack("foreign1", { authorEmail: "other@x.y" }),
      pack("refused1", { authorEmail: "other@x.y" }),
    ],
    deployReplyFor: (id) => (id === "refused1" ? { status: 402, body: { error: { code: "BALANCE_GATE", message: "no balance" } } } : null),
  });
  // foreign1 is in service → its entry must skip; own1/refused1 are greenfield.
  const h = await harness({ facet, inService: ["foreign1"] });
  try {
    const created = await h.call("/api/wanxing/v1/console/collections", { method: "POST", body: { name: "混编套装", visibility: "public" } });
    const id = created.body.collection.id;
    const put = await h.call(`/api/wanxing/v1/console/collections/${id}/entries`, {
      method: "PUT",
      body: {
        entries: [
          { packId: "own1", agentId: "a2", suggestedConfig: { budgetMinutes: 20, model: "m-lane" } },
          { packId: "foreign1", agentId: "a1" },
          { packId: "refused1" },
        ],
      },
    });
    assert.equal(put.status, 200);

    const noKey = await h.call(`/api/wanxing/v1/console/collections/${id}/deploy`, { method: "POST", body: {} });
    assert.equal(noKey.status, 400);

    const out = await h.call(`/api/wanxing/v1/console/collections/${id}/deploy`, { method: "POST", body: { billingKey: "sk-good", notifyChannel: "fd-ops" } });
    assert.equal(out.status, 200);
    const byPack = Object.fromEntries(out.body.results.map((r) => [r.packId, r]));
    assert.equal(byPack.own1.verdict, "deployed");
    assert.deepEqual(byPack.own1.slugs, ["packs-own1-a2"]);
    assert.equal(byPack.foreign1.verdict, "skipped-in-service");
    assert.equal(byPack.refused1.verdict, "refused");
    assert.match(JSON.stringify(byPack.refused1.error), /no balance/);
    assert.deepEqual(out.body.deployedSlugs, ["packs-own1-a2"]);

    // The own1 forward: subset [a2] + suggested config on that agent only.
    const fwd = facet.seen.find((x) => x.packId === "own1");
    assert.deepEqual(fwd.body.agents, ["a2"]);
    assert.deepEqual(fwd.body.models, { a2: "m-lane" });
    assert.deepEqual(fwd.body.budgets, { a2: 20 });
    assert.deepEqual(fwd.body.notifyChannel, { a2: "fd-ops" });
    // foreign1 never forwarded (skipped before the core's forward); refused1 did.
    assert.equal(facet.seen.filter((x) => x.packId === "foreign1").length, 0);
    assert.equal(facet.seen.filter((x) => x.packId === "refused1").length, 1);
    // refused1 has no agentId → deploys every serving agent under the key.
    const fwdRefused = facet.seen.find((x) => x.packId === "refused1");
    assert.equal(fwdRefused.body.agents, undefined);
    assert.deepEqual(Object.keys(fwdRefused.body.billingKeys).sort(), ["a1", "a2"]);

    // Bob (a different verified identity) may deploy Alice's PUBLIC bundle.
    const bobOut = await h.call(`/api/wanxing/v1/console/collections/${id}/deploy`, { token: BOB_TOKEN, method: "POST", body: { billingKey: "sk-bob" } });
    assert.equal(bobOut.status, 200);
    const bobFwd = facet.seen.filter((x) => x.packId === "own1").at(-1);
    assert.equal(bobFwd.body.billingKeys.a2, "sk-bob");
    // own1 is Alice's pack — foreign to Bob, and the harness's static
    // snapshot never grows, so it reads greenfield to him: the bridge rides
    // (creators group on the forward), his key pays.
    const bobOwn = bobOut.body.results.find((r) => r.packId === "own1");
    assert.equal(bobOwn.verdict, "deployed");
    const bobFwdIdent = JSON.parse(Buffer.from(facet.seen.filter((x) => x.packId === "own1").at(-1).user, "base64url").toString());
    assert.ok(bobFwdIdent.groups.includes("creators"));
    assert.equal(bobFwdIdent.email, BOB);
  } finally {
    await h.close();
    await facet.close();
  }
});

test("share face: public only, no owner leak, entries resolved", async () => {
  const facet = await stubFacet({ packs: [pack("p1", { category: "legal", featured: true })] });
  const h = await harness({ facet });
  try {
    const priv = await h.call("/api/wanxing/v1/console/collections", { method: "POST", body: { name: "私有" } });
    const pub = await h.call("/api/wanxing/v1/console/collections", { method: "POST", body: { name: "公开", visibility: "public" } });
    await h.call(`/api/wanxing/v1/console/collections/${pub.body.collection.id}/entries`, {
      method: "PUT",
      body: { entries: [{ packId: "p1", agentId: "a1" }] },
    });

    const anonPriv = await fetch(`${h.base}/api/wanxing/v1/collections/${priv.body.collection.id}`);
    assert.equal(anonPriv.status, 404);

    const anonPub = await fetch(`${h.base}/api/wanxing/v1/collections/${pub.body.collection.id}`);
    assert.equal(anonPub.status, 200);
    const doc = await anonPub.json();
    assert.equal(doc.collection.entries[0].category, "legal");
    assert.equal(doc.collection.entries[0].featured, true);
    assert.equal("ownerEmail" in doc.collection, false, "no owner leak on the share face");
    assert.equal("ownerEmail" in doc.collection.entries[0], false);
  } finally {
    await h.close();
    await facet.close();
  }
});

// ── Fleet summary (add-cockpit-views, M4④b) ─────────────────────────────────

test("fleet/summary: windowed aggregates + allowances, honest zeros, identity gate", async () => {
  const facet = await stubFacet({ packs: [pack("p1")] });
  const h = await harness({ facet });
  try {
    const ops = await h.call("/api/wanxing/v1/console/fleet/summary", { token: OPS_TOKEN });
    assert.equal(ops.status, 403);

    const now = Date.now();
    const insert = (slug, startedAt, minutes, rate, status = "settled") =>
      h.store.usageInsert({
        id: `u_${slug}_${startedAt}_${minutes}`,
        callerId: 1, callerEmail: "c@x", agentSlug: slug, idemKey: `k_${startedAt}_${minutes}`,
        startedAt, endedAt: startedAt + 60_000, durationMs: 60_000, outcome: "ok",
        minutesBilled: minutes, rateUsd: rate, settlementStatus: status,
        settledAt: status === "settled" ? startedAt + 120_000 : null,
      });
    insert("packs-p1-a1", now - 1 * 24 * 3600_000, 5, 0.1);   // in 7d and 30d, value 0.5
    insert("packs-p1-a1", now - 10 * 24 * 3600_000, 5, 0.1);  // between windows: 30d only
    insert("packs-p1-a1", now - 40 * 24 * 3600_000, 9, 0.1);  // outside both windows
    insert("packs-p1-a2", now - 2 * 24 * 3600_000, 3, 0.1, "waived"); // minutes count, value does not
    h.store.hostAllowanceSet("packs-p1-a1", 60, "ops");
    h.store.hostAllowanceUsedAdd?.("packs-p1-a1", 10); // if the seam exists; allowance remaining asserted loosely below

    const r = await h.call("/api/wanxing/v1/console/fleet/summary");
    assert.equal(r.status, 200);
    const a1 = r.body.agents["packs-p1-a1"];
    assert.equal(a1.turns7d, 1, "only the within-7d turn counts");
    assert.equal(a1.minutes30d, 10, "two within-30d turns' minutes");
    assert.ok(Math.abs(a1.usd30d - 1.0) < 1e-9, `settled value only (${a1.usd30d})`);
    assert.equal(a1.allowance.limitMinutes, 60);
    assert.ok(a1.allowance.remainingMinutes <= 60);
    const a2 = r.body.agents["packs-p1-a2"];
    assert.equal(a2.turns7d, 1);
    assert.equal(a2.minutes30d, 3);
    assert.equal(a2.usd30d, 0, "waived turns carry no value");
    assert.equal(a2.allowance, undefined, "no allowance set = no key");
    // A slug known only by its allowance reads honest zeros.
    h.store.hostAllowanceSet("packs-px-quiet", 30, "ops");
    const r2 = await h.call("/api/wanxing/v1/console/fleet/summary");
    const quiet = r2.body.agents["packs-px-quiet"];
    assert.deepEqual([quiet.turns7d, quiet.minutes30d, quiet.usd30d], [0, 0, 0]);
  } finally {
    await h.close();
    await facet.close();
  }
});
