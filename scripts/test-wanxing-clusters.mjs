// Cluster tests — add-cluster-catalog-grouping (§A) and add-cluster-service-unit
// (§B): the catalog's cluster index + marker + filter, the self-service
// declaration pass-through, and the cluster unit's route family. Same
// in-process harness as test-wanxing-facade.mjs: an express app over the
// a2a face with stubbed registry / packs browse+detail / upstream / sub2api.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { test } from "node:test";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-clusters-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore, slugFor } = await import("../services/wanxing-facade/core.js");
const { createA2aFace, clusterEntryOf } = await import("../services/wanxing-facade/a2a.js");

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

// ── Fixtures ────────────────────────────────────────────────────────────────
// p1: a declared cluster (defaults a, b; optional c; d is a pack agent the
//     declaration does not name). a, c, d are deployed; b is not.
// p2: a two-agent pack WITHOUT a cluster block (both deployed) — stays flat.
// p3: a single-agent pack.
const CLUSTER_MANIFEST = {
  name: "柏讯 · 投研三镜头",
  agents: [
    { id: "a", name: "宏观", persona: "…" },
    { id: "b", name: "估值", persona: "…" },
    { id: "c", name: "投委会", persona: "…" },
    { id: "d", name: "杂役", persona: "…" },
  ],
  cluster: {
    name: "投研三镜头",
    description: "三个镜头并行审读",
    defaultAgents: ["a", "b"],
    optionalAgents: ["c", "a"], // the duplicate of a default is dropped
    schedulingPolicy: { maxConcurrentRuns: 2 },
  },
};
const FLAT_MANIFEST = { name: "双子", agents: [{ id: "x", name: "甲" }, { id: "y", name: "乙" }] };

const dep = (packId, agentId) => ({ packId, agentId, agentPath: `/packs/${packId}/${agentId}`, slug: slugFor(`/packs/${packId}/${agentId}`) });
const DEPLOYMENTS = [dep("p1", "a"), dep("p1", "c"), dep("p1", "d"), dep("p2", "x"), dep("p2", "y"), dep("p3", "solo")];

function stubSub2api() {
  return {
    degraded: () => false,
    probeKeyLiveness: async () => ({ ok: true }),
    findUserByKey: async () => ({ userId: 7, email: "caller@finddata.tech" }),
    adjustBalance: async () => ({ ok: true }),
    getUser: async () => ({ userId: 7, email: "caller@finddata.tech", balance: 10 }),
  };
}

function harness({
  deployments = DEPLOYMENTS,
  browse = [
    { id: "p1", name: "柏讯 · 投研三镜头", version: 1, agentCount: 4, category: "research" },
    { id: "p2", name: "双子", version: 2, agentCount: 2 },
    { id: "p3", name: "独行", version: 1, agentCount: 1, category: "docs" },
  ],
  details = { p1: { manifest: CLUSTER_MANIFEST }, p2: { manifest: FLAT_MANIFEST } },
  detailImpl = null,
  entryFor = null,
  upstream = null,
  store = freshStore(),
} = {}) {
  const core = createWanxingCore({ store, sub2api: stubSub2api(), config: { ratePerMin: 0.1, rpmMax: 100 } });
  const detailCalls = [];
  const upstreamCalls = [];
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => deployments.find((d) => d.slug === slug) ?? null,
    listDeployments: () => deployments,
    forwardHeaders: () => ({ "X-Authorization": "Bearer svc", Authorization: "Bearer backend" }),
    registryFetch: async (p) => {
      const agentPath = p.replace(/^\/api\/agents/, "");
      const d = deployments.find((x) => x.agentPath === agentPath);
      const base = { name: `${d?.packId}/${d?.agentId}`, description: `agent ${d?.agentId}`, version: "1", visibility: "public", skills: [], tags: [], metadata: {} };
      return new Response(JSON.stringify({ ...base, ...(entryFor ? entryFor(d) : {}) }), { headers: { "Content-Type": "application/json" } });
    },
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async (url, init) => {
      upstreamCalls.push({ url, init });
      return upstream ? upstream(url, init) : new Response("{}", { headers: { "Content-Type": "application/json" } });
    },
    packsBrowseFetch: async () => browse,
    packsDetailFetch: async (id) => {
      detailCalls.push(id);
      if (detailImpl) return detailImpl(id);
      if (!(id in details)) throw new Error(`detail ${id} unavailable`);
      return details[id];
    },
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    core, store, face, base, detailCalls, upstreamCalls,
    close: () => new Promise((r) => server.close(r)),
    call: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
  };
}

// Advance the face's wall clock past its 60s signal TTL.
const withClockSkew = async (ms, fn) => {
  const real = Date.now;
  Date.now = () => real() + ms;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
};

// ── §A.0 the pure index entry ───────────────────────────────────────────────

test("A clusterEntryOf: a declared cluster yields the team, names and policy; undeclared yields null", () => {
  const e = clusterEntryOf({ id: "p1", version: 1, name: "pack" }, { manifest: CLUSTER_MANIFEST });
  assert.equal(e.id, "p1");
  assert.equal(e.name, "投研三镜头");
  assert.deepEqual(e.defaultAgents, ["a", "b"]);
  assert.deepEqual(e.optionalAgents, ["c"], "a default repeated under optional is dropped");
  assert.deepEqual(e.agentNames, { a: "宏观", b: "估值", c: "投委会" }, "names come from the agent list, the team from the declaration");
  assert.deepEqual(e.policy, { maxConcurrentRuns: 2 });
  assert.equal(clusterEntryOf({ id: "p2", version: 2 }, { manifest: FLAT_MANIFEST }), null);
  assert.equal(clusterEntryOf({ id: "p9", version: 1 }, { manifest: { cluster: { name: "x", defaultAgents: [] } } }), null, "empty defaults is not a team");
  assert.equal(clusterEntryOf({ id: "p9", version: 1 }, null), null);
});

// ── §A.1 catalog marker ─────────────────────────────────────────────────────

test("A catalog: declared members carry the marker with role and team size; undeclared agents and undeclared packs stay flat", async () => {
  const h = harness();
  try {
    const r = await h.call("/api/wanxing/v1/agents");
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.agents.map((a) => [a.slug, a]));
    assert.deepEqual(by["packs-p1-a"].cluster, { id: "p1", name: "投研三镜头", role: "default", members: 3 });
    assert.deepEqual(by["packs-p1-c"].cluster, { id: "p1", name: "投研三镜头", role: "optional", members: 3 });
    assert.equal("cluster" in by["packs-p1-d"], false, "an agent the declaration does not name is not a member");
    assert.equal("cluster" in by["packs-p2-x"], false, "a multi-agent pack without a declaration does not group");
    assert.equal("cluster" in by["packs-p2-y"], false);
    assert.equal("cluster" in by["packs-p3-solo"], false);
    assert.equal(Object.keys(r.body).join(","), "agents", "a bare request keeps the legacy shape");
    assert.deepEqual([...h.detailCalls].sort(), ["p1", "p2"], "only multi-agent browse rows are detailed");
  } finally {
    await h.close();
  }
});

test("A card: a member's agent card carries the same marker; a flat agent's card does not", async () => {
  const h = harness();
  try {
    const a = await h.call("/api/wanxing/v1/a2a/packs-p1-a/.well-known/agent-card.json");
    assert.equal(a.status, 200);
    assert.deepEqual(a.body.cluster, { id: "p1", name: "投研三镜头", role: "default", members: 3 });
    const solo = await h.call("/api/wanxing/v1/a2a/packs-p3-solo/.well-known/agent-card.json");
    assert.equal(solo.status, 200);
    assert.equal("cluster" in solo.body, false);
  } finally {
    await h.close();
  }
});

test("A catalog: cluster= filters before pagination and composes with q; facets.clusters counts the unfiltered list", async () => {
  const h = harness();
  try {
    const page = await h.call("/api/wanxing/v1/agents?cluster=p1&page=1&page_size=1");
    assert.equal(page.body.total, 2, "a and c are the public members; d is not a member");
    assert.equal(page.body.agents.length, 1);
    assert.equal(page.body.agents[0].cluster.id, "p1");
    const composed = await h.call("/api/wanxing/v1/agents?cluster=p1&q=agent%20c");
    assert.deepEqual(composed.body.agents.map((a) => a.slug), ["packs-p1-c"]);
    const none = await h.call("/api/wanxing/v1/agents?cluster=p2");
    assert.equal(none.body.total, 0, "an undeclared pack is not a cluster");
    const facets = await h.call("/api/wanxing/v1/agents?facets=1&category=docs");
    assert.equal(facets.body.total, 1, "the docs filter applies to the page");
    assert.equal(facets.body.facets.clusters, 1, "cluster count ignores the active filter");
    assert.equal(facets.body.facets.total, 6);
  } finally {
    await h.close();
  }
});

test("A index: a version bump whose detail fails keeps the last-known entry; once the detail answers, the new declaration lands", async () => {
  let fail = false;
  let version = 1;
  const browse = () => [
    { id: "p1", name: "柏讯 · 投研三镜头", version, agentCount: 4 },
    { id: "p3", name: "独行", version: 1, agentCount: 1 },
  ];
  const renamed = { manifest: { ...CLUSTER_MANIFEST, cluster: { ...CLUSTER_MANIFEST.cluster, name: "改名小队" } } };
  const store = freshStore();
  const core = createWanxingCore({ store, sub2api: stubSub2api(), config: { ratePerMin: 0.1, rpmMax: 100 } });
  const detailCalls = [];
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => DEPLOYMENTS.find((d) => d.slug === slug) ?? null,
    listDeployments: () => DEPLOYMENTS.filter((d) => d.packId !== "p2"),
    forwardHeaders: () => ({}),
    registryFetch: async () => new Response(JSON.stringify({ name: "n", description: "d", version: "1", visibility: "public", metadata: {} }), { headers: { "Content-Type": "application/json" } }),
    config: { agentUrlFor: (p) => p },
    packsBrowseFetch: async () => browse(),
    packsDetailFetch: async (id) => {
      detailCalls.push(id);
      if (fail) throw new Error("detail down");
      return version === 1 ? { manifest: CLUSTER_MANIFEST } : renamed;
    },
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = () => fetch(`${base}/api/wanxing/v1/agents`).then((r) => r.json());
  const nameOfA = (doc) => doc.agents.find((a) => a.slug === "packs-p1-a").cluster.name;
  try {
    assert.equal(nameOfA(await read()), "投研三镜头");
    assert.deepEqual(detailCalls, ["p1"]);

    // Same version within the TTL: no refresh, no detail call.
    assert.equal(nameOfA(await read()), "投研三镜头");
    assert.deepEqual(detailCalls, ["p1"], "a same-version refresh never re-reads the detail");

    // A republish (new version key) whose detail is down: the entry survives.
    version = 2;
    fail = true;
    assert.equal(nameOfA(await withClockSkew(61_000, read)), "投研三镜头", "a failed detail keeps the last-known entry");
    assert.deepEqual(detailCalls, ["p1", "p1"], "the new key was tried");

    // The detail recovers: the new declaration lands.
    fail = false;
    assert.equal(nameOfA(await withClockSkew(122_000, read)), "改名小队", "a republish re-reads under the new key");
    assert.deepEqual(detailCalls, ["p1", "p1", "p1"]);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("A index: without a detail fetcher the catalog is unchanged (no grouping, no failure)", async () => {
  const store = freshStore();
  const core = createWanxingCore({ store, sub2api: stubSub2api(), config: { ratePerMin: 0.1, rpmMax: 100 } });
  const face = createA2aFace({
    core,
    resolveDeployment: () => null,
    listDeployments: () => DEPLOYMENTS,
    forwardHeaders: () => ({}),
    registryFetch: async () => new Response(JSON.stringify({ name: "n", description: "d", version: "1", visibility: "public", metadata: {} }), { headers: { "Content-Type": "application/json" } }),
    config: { agentUrlFor: (p) => p },
    packsBrowseFetch: async () => [{ id: "p1", version: 1, agentCount: 4 }],
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/wanxing/v1/agents?facets=1`).then((x) => x.json());
    assert.ok(r.agents.every((a) => !("cluster" in a)));
    assert.equal(r.facets.clusters, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
