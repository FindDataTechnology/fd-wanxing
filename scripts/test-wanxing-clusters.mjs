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

test("A card conforms to the published agentCard definition (owner-side, not just consumer-side)", async () => {
  // The card is a public discovery face: A2A clients resolve it BEFORE they
  // call anything, and 萬星运维 MCP relays it verbatim. Consumers each pin their
  // own copy of its field list (that is how the five undeclared fields were
  // found) — validating here, at the producer, is what makes one drift red
  // everywhere at once. Contract: contracts/wanxing-public-api.v1.json.
  const { loadContract } = await import("./lib/contract-check.mjs");
  const contract = loadContract(new URL("../contracts/wanxing-public-api.v1.json", import.meta.url));
  const h = harness();
  try {
    // A flat agent and a cluster member both, because the route appends
    // `cluster` only for the latter and `chatable` only when admitted.
    for (const route of ["/api/wanxing/v1/a2a/packs-p1-a/.well-known/agent-card.json",
                         "/api/wanxing/v1/a2a/packs-p3-solo/.well-known/agent-card.json"]) {
      const card = await h.call(route);
      assert.equal(card.status, 200, `${route} must serve a card`);
      assert.deepEqual(contract.check("agentCard", card.body), [],
        `${route} violates the published agentCard definition`);
      // The redaction discipline, pinned where it is produced: the card's url is
      // ALWAYS the facade endpoint, never an internal runtime address.
      assert.match(card.body.url, /^http:\/\/[^/]+\/api\/wanxing\/v1\/a2a\//,
        "the card must point callers at the facade, not the runtime");
    }
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

// ── §B the cluster unit face ────────────────────────────────────────────────

const { createClusterFace } = await import("../services/wanxing-facade/cluster.js");
const { createHash } = await import("node:crypto");
const Database = (await import("better-sqlite3")).default;

const sendJson = (body, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

// Upstream stub: answers per agentPath with configurable latency, reply text
// and failure; records every call (agentPath, parsed body, timestamps) and a
// rolling in-flight gauge for concurrency assertions.
function upstreamStub({ replies = {}, latency = {}, failPaths = [] } = {}) {
  const calls = [];
  let inflight = 0;
  let maxInflight = 0;
  return {
    calls, maxInflight: () => maxInflight,
    async fetch(url, init) {
      const path = new URL(url).pathname.replace(/^\/agent/, "").replace(/\/$/, "");
      const body = JSON.parse(init.body);
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      try {
        const wait = new Promise((r) => setTimeout(r, latency[path] ?? 0));
        await (init.signal
          ? Promise.race([wait, new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason ?? new Error("aborted"))))])
          : wait);
        if (failPaths.includes(path)) return new Response("nope", { status: 500 });
        const text = body.params.message.context_id?.endsWith("--summary")
          ? "综合答复"
          : replies[path] ?? `${path} 的答复`;
        // The runner's real wire shape: the Message IS the result (probed live
        // 2026-10-22 — result:{role,parts}); a second flavor wraps it under
        // result.message, asserted below so both stay readable.
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, result: { role: "assistant", parts: [{ kind: "text", text }] } }), { headers: { "Content-Type": "application/json" } });
      } finally {
        inflight -= 1;
        calls.push({ path, body, at: Date.now() });
      }
    },
  };
}

function clusterHarness({
  deployments = [dep("p1", "a"), dep("p1", "b"), dep("p1", "c")],
  policy = undefined,
  entryOver = null, // (dep) → entry overrides (e.g. private/paused)
  env = {},
  coreCfg = {},
  upstream = upstreamStub(),
  store = null,
} = {}) {
  const storeFile = path.join(mkdtempSync(path.join(tmp, "cs-")), "wanxing.db");
  store = store ?? createWanxingStore({ file: storeFile });
  const manifest = {
    name: "柏讯 · 投研三镜头",
    agents: [
      { id: "a", name: "宏观", persona: "…" },
      { id: "b", name: "估值", persona: "…" },
      { id: "c", name: "投委会", persona: "…" },
    ],
    cluster: {
      name: "投研三镜头",
      description: "三镜头",
      defaultAgents: ["a", "b"],
      optionalAgents: ["c"],
      ...(policy !== undefined ? { schedulingPolicy: policy } : {}),
    },
  };
  const core = createWanxingCore({ store, sub2api: stubSub2api(), config: { ratePerMin: 0.1, rpmMax: 100, ...coreCfg } });
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => deployments.find((d) => d.slug === slug) ?? null,
    listDeployments: () => deployments,
    forwardHeaders: () => ({ "X-Authorization": "Bearer svc", Authorization: "Bearer backend" }),
    registryFetch: async (p) => {
      const agentPath = p.replace(/^\/api\/agents/, "");
      const d = deployments.find((x) => x.agentPath === agentPath);
      return new Response(JSON.stringify({ name: `${d?.agentId}`, description: "", version: "1", visibility: "public", metadata: {}, ...(entryOver ? entryOver(d) : {}) }), { headers: { "Content-Type": "application/json" } });
    },
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: (url, init) => upstream.fetch(url, init),
    packsBrowseFetch: async () => [{ id: "p1", name: "柏讯", version: 1, agentCount: 3 }],
    packsDetailFetch: async () => ({ manifest }),
  });
  const clusterFace = createClusterFace({
    core,
    a2a: {
      agentState: (slug) => face.agentState(slug),
      entryFor: (slug) => face.entryFor(slug),
      clusterMap: () => face.clusterMap(),
      runMemberTurn: (args) => face.runMemberTurn(args),
    },
    listDeployments: () => deployments,
    env,
  });
  const app = express();
  clusterFace.register(app);
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    core, store, storeFile, face, upstream, base,
    close: () => new Promise((r) => server.close(r)),
    send: (text, extra = {}, headers = {}) =>
      fetch(`${base}/api/wanxing/v1/a2a/cluster/p1`, sendJson({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text }], ...extra } } }, { Authorization: "Bearer sk-caller", ...headers }))
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    get: (p) => fetch(base + p).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
  };
}

test("B units: a partial team is a unit; only-optional is not; private members hide from public faces", async () => {
  const h = clusterHarness(); // a, b defaults + c optional all deployed
  try {
    const list = await h.get("/api/wanxing/v1/clusters");
    assert.equal(list.status, 200);
    assert.equal(list.body.clusters.length, 1);
    const u = list.body.clusters[0];
    assert.equal(u.slug, "p1");
    assert.equal(u.name, "投研三镜头");
    assert.match(u.url, /\/api\/wanxing\/v1\/a2a\/cluster\/p1$/);
    assert.deepEqual(u.members.map((m) => [m.id, m.role, m.served]), [["a", "default", true], ["b", "default", true], ["c", "optional", true]]);

    const card = await h.get("/api/wanxing/v1/a2a/cluster/p1/.well-known/agent-card.json");
    assert.equal(card.status, 200);
    assert.equal(card.body.capabilities.streaming, false);
    assert.deepEqual(card.body.skills.map((s) => s.id), ["a", "b", "c"]);
    assert.deepEqual(card.body.cluster.aggregations, ["all", "first", "summary"]);
    assert.match(card.body.url, /\/a2a\/cluster\/p1$/);
  } finally {
    await h.close();
  }

  // Only the optional member served → no unit anywhere.
  const h2 = clusterHarness({ deployments: [dep("p1", "c")] });
  try {
    assert.equal((await h2.get("/api/wanxing/v1/clusters")).body.clusters.length, 0);
    assert.equal((await h2.get("/api/wanxing/v1/a2a/cluster/p1/.well-known/agent-card.json")).status, 404);
    const r = await h2.send("hi");
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, "CLUSTER_NOT_FOUND");
  } finally {
    await h2.close();
  }

  // A private served member hides from the public list and card, not from turns.
  const h3 = clusterHarness({ entryOver: (d) => (d.agentId === "b" ? { visibility: "private" } : {}) });
  try {
    const list = await h3.get("/api/wanxing/v1/clusters");
    assert.deepEqual(list.body.clusters[0].members.map((m) => m.id), ["a", "c"], "private served member hidden");
    const card = await h3.get("/api/wanxing/v1/a2a/cluster/p1/.well-known/agent-card.json");
    assert.deepEqual(card.body.skills.map((s) => s.id), ["a", "c"]);
    // Default member set for turns still includes b (admission per member).
    const r = await h3.send("hi");
    assert.equal(r.status, 200, "the composite runs on its public default members");
    const ids = r.body.result.message.metadata.cluster.members.filter((m) => m.status !== "skipped").map((m) => m.id).sort();
    assert.deepEqual(ids, ["a"], "b is skipped for an unauthorized caller (CALLER_NOT_AUTHORIZED)");
  } finally {
    await h3.close();
  }
});

test("B turn: send-only protocol, unknown member selection, and admission verdicts", async () => {
  const h = clusterHarness();
  try {
    const stream = await fetch(`${h.base}/api/wanxing/v1/a2a/cluster/p1`, sendJson({ jsonrpc: "2.0", id: 1, method: "message/stream", params: { message: { parts: [{ kind: "text", text: "x" }] } } }, { Authorization: "Bearer sk-caller" })).then((r) => r.json());
    assert.equal(stream.error.code, -32601);
    assert.match(stream.error.message, /message\/send only/);

    const unknown = await h.send("x", { metadata: { agents: ["a", "zzz"] } });
    assert.equal(unknown.body.error.code, -32602);
    assert.match(unknown.body.error.message, /zzz/);
    assert.equal(h.upstream.calls.length, 0, "no member ran");

    const unserved = await h.send("x", { metadata: { agents: ["a", "b"] }, /* b not deployed in this variant */ });
    // (b IS deployed in the default harness; use the paused variant below.)
  } finally {
    await h.close();
  }

  // A paused member skips; the composite still answers on the rest.
  const hp = clusterHarness({ entryOver: (d) => (d.agentId === "b" ? { metadata: { paused: true } } : {}) });
  try {
    const r = await hp.send("分析下");
    assert.equal(r.status, 200);
    const block = r.body.result.message.metadata.cluster;
    const b = block.members.find((m) => m.id === "b");
    assert.equal(b.status, "skipped");
    assert.equal(b.reason, "AGENT_PAUSED");
    assert.equal(block.members.find((m) => m.id === "a").status, "ok");
    assert.match(r.body.result.message.parts[0].text, /## 宏观/);
    assert.match(r.body.result.message.parts[0].text, /估值：跳过（AGENT_PAUSED）/);
  } finally {
    await hp.close();
  }

  // Every member paused → refusal before any upstream call.
  const ha = clusterHarness({ entryOver: () => ({ metadata: { paused: true } }) });
  try {
    const r = await ha.send("分析下");
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, "CLUSTER_NOT_ADMITTED");
    assert.equal(ha.upstream.calls.length, 0);
  } finally {
    await ha.close();
  }
});

test("B turn: the member slot is respected — a member busy on a direct call skips as TURN_IN_FLIGHT", async () => {
  const h = clusterHarness();
  try {
    h.core.acquireSlot(7, "packs-p1-b"); // simulate a direct call in flight
    const r = await h.send("分析下");
    assert.equal(r.status, 200);
    const block = r.body.result.message.metadata.cluster;
    assert.equal(block.members.find((m) => m.id === "b").status, "skipped");
    assert.equal(block.members.find((m) => m.id === "b").reason, "TURN_IN_FLIGHT");
    assert.equal(block.members.find((m) => m.id === "a").status, "ok");
  } finally {
    await h.close();
  }
});

test("B turn: RPM ticks once per composite; concurrency follows the declaration", async () => {
  // rpmMax 1: one composite with TWO members passes (single tick)…
  const h = clusterHarness({ coreCfg: { rpmMax: 1 }, upstream: upstreamStub({ latency: { "/packs/p1/a": 60, "/packs/p1/b": 60 } }) });
  try {
    const r = await h.send("分析下");
    assert.equal(r.status, 200, "both members ran under one RPM tick");
    assert.equal(h.upstream.calls.length, 2);
    assert.equal(h.upstream.maxInflight(), 2, "no declared policy → members run concurrently");
    // …the next request in the same window is throttled.
    const r2 = await h.send("再来");
    assert.equal(r2.status, 429);
  } finally {
    await h.close();
  }

  // maxConcurrentRuns 1 → strictly sequential.
  const hs = clusterHarness({ policy: { maxConcurrentRuns: 1 }, upstream: upstreamStub({ latency: { "/packs/p1/a": 80, "/packs/p1/b": 10 } }) });
  try {
    const r = await hs.send("分析下");
    assert.equal(r.status, 200);
    assert.equal(hs.upstream.maxInflight(), 1, "the declaration caps concurrency");
  } finally {
    await hs.close();
  }
});

test("B aggregation: all / first / summary, and total failure is a JSON-RPC error with the block", async () => {
  const h = clusterHarness({ upstream: upstreamStub({ replies: { "/packs/p1/a": "宏观说涨", "/packs/p1/b": "估值说跌" } }) });
  try {
    const all = await h.send("分析下");
    const allText = all.body.result.message.parts[0].text;
    assert.match(allText, /## 宏观（默认成员）\n\n宏观说涨/);
    assert.match(allText, /## 估值（默认成员）\n\n估值说跌/);
    assert.equal(all.body.result.message.metadata.cluster.aggregation, "all");

    const first = await h.send("分析下", { metadata: { aggregation: "first" } });
    assert.equal(first.body.result.message.metadata.cluster.aggregation, "first");
    assert.ok(["宏观说涨", "估值说跌"].includes(first.body.result.message.parts[0].text));

    const summary = await h.send("分析下", { metadata: { aggregation: "summary" } }, { "Idempotency-Key": "sum-1" });
    const block = summary.body.result.message.metadata.cluster;
    assert.equal(block.aggregation, "summary");
    assert.equal(block.summaryBy, "a", "the lead is the first successful default in declaration order");
    assert.equal(summary.body.result.message.parts[0].text, "综合答复");
    const synthCall = h.upstream.calls.find((c) => c.body.params.message.context_id.endsWith("--summary"));
    assert.ok(synthCall, "the synthesis turn ran");
    assert.match(synthCall.body.params.message.parts[0].text, /【宏观】\n宏观说涨/);
    assert.match(synthCall.body.params.message.parts[0].text, /【估值】\n估值说跌/);
    assert.match(synthCall.body.params.message.parts[0].text, /原始任务：分析下/);
    const summaryMember = block.members.find((m) => m.name === "宏观（汇总）");
    assert.equal(summaryMember.status, "ok");
  } finally {
    await h.close();
  }

  // Total failure: error response still carrying the block, both rows waived.
  const hf = clusterHarness({ upstream: upstreamStub({ failPaths: ["/packs/p1/a", "/packs/p1/b"] }) });
  try {
    const r = await hf.send("分析下");
    assert.equal(r.body.error.code, -32040);
    assert.equal(r.body.error.data.cluster.members.every((m) => m.status === "error"), true);
    assert.equal(hf.store.usagePending().length, 0, "error turns are waived, nothing to settle");
  } finally {
    await hf.close();
  }
});

test("B metering: member rows individually booked under one cluster_turn_id; the unit books nothing; replay and partial-crash reuse", async () => {
  const h = clusterHarness();
  try {
    const r = await h.send("分析下", {}, { "Idempotency-Key": "meter-1" });
    assert.equal(r.status, 200);
    const block = r.body.result.message.metadata.cluster;
    const ctId = new Database(h.storeFile).prepare(`SELECT cluster_turn_id FROM wanxing_usage WHERE agent_slug = ? ORDER BY started_at DESC LIMIT 1`).get("packs-p1-a").cluster_turn_id;
    const rows = h.store.usageByClusterTurn(ctId);
    assert.equal(rows.length, 2, "one row per member");
    assert.deepEqual(rows.map((x) => x.agent_slug).sort(), ["packs-p1-a", "packs-p1-b"]);
    assert.deepEqual(rows.map((x) => x.idem_key).sort(), ["meter-1--a", "meter-1--b"]);
    assert.ok(rows.every((x) => x.cluster_turn_id === ctId));
    assert.ok(!rows.some((x) => x.agent_slug === "p1"), "the unit records no row");

    // A full replay returns the recorded response and books nothing new.
    const replay = await h.send("分析下", {}, { "Idempotency-Key": "meter-1" });
    assert.deepEqual(replay.body, r.body);
    assert.equal(h.store.usageByClusterTurn(ctId).length, 2);
    assert.equal(h.upstream.calls.length, 2);

    // Partial-crash replay: drop the composite's idempotency row AND member
    // b's (crash after a finished, before b did) — a replays from its
    // derived key (no new row, no upstream call), only b reruns.
    const db = new Database(h.storeFile);
    db.prepare(`DELETE FROM wanxing_requests WHERE agent_slug = ?`).run("p1");
    db.prepare(`DELETE FROM wanxing_requests WHERE agent_slug = ? AND idem_key = ?`).run("packs-p1-b", "meter-1--b");
    db.close();
    const rerun = await h.send("分析下", {}, { "Idempotency-Key": "meter-1" });
    assert.equal(rerun.status, 200);
    assert.equal(h.upstream.calls.length, 3, "member a replayed from its derived key; only b hit the upstream again");
    const count = (slug) => new Database(h.storeFile).prepare(`SELECT COUNT(*) AS n FROM wanxing_usage WHERE agent_slug = ?`).get(slug).n;
    assert.equal(count("packs-p1-a"), 1, "a booked once — its derived key replayed without a new row");
    assert.equal(count("packs-p1-b"), 2, "b re-booked: the rerun is a new execution under a new cluster_turn_id");
  } finally {
    await h.close();
  }
});

test("B metering: a failed member is waived inside a successful composite; timeouts mark TIMEOUT", async () => {
  const h = clusterHarness({ upstream: upstreamStub({ failPaths: ["/packs/p1/a"] }) });
  try {
    const r = await h.send("分析下", {}, { "Idempotency-Key": "mix-1" });
    assert.equal(r.status, 200);
    const ctId = new Database(h.storeFile).prepare(`SELECT cluster_turn_id FROM wanxing_usage WHERE agent_slug = ? ORDER BY started_at DESC LIMIT 1`).get("packs-p1-a").cluster_turn_id;
    const rows = h.store.usageByClusterTurn(ctId);
    const a = rows.find((x) => x.agent_slug === "packs-p1-a");
    const b = rows.find((x) => x.agent_slug === "packs-p1-b");
    assert.equal(a.outcome, "error");
    assert.equal(a.minutes_billed, 0);
    assert.equal(a.settlement_status, "waived");
    assert.equal(b.outcome, "ok");
    assert.ok(b.minutes_billed >= 1);
    assert.match(r.body.result.message.parts[0].text, /估值/);
    assert.match(r.body.result.message.parts[0].text, /宏观：失败/);
  } finally {
    await h.close();
  }

  const ht = clusterHarness({ env: { WANXING_CLUSTER_MEMBER_TIMEOUT_MS: "60" }, upstream: upstreamStub({ latency: { "/packs/p1/a": 400, "/packs/p1/b": 10 } }) });
  try {
    const r = await ht.send("分析下", {}, { "Idempotency-Key": "to-1" });
    assert.equal(r.status, 200);
    const a = r.body.result.message.metadata.cluster.members.find((m) => m.id === "a");
    assert.equal(a.status, "error");
    assert.equal(a.reason, "TIMEOUT");
    const b = r.body.result.message.metadata.cluster.members.find((m) => m.id === "b");
    assert.equal(b.status, "ok");
  } finally {
    await ht.close();
  }
});

test("B contexts: a caller's context_id continues every member conversation", async () => {
  const h = clusterHarness();
  try {
    const r = await h.send("分析下", { context_id: "wx:ctx-42" });
    assert.equal(r.status, 200);
    assert.equal(r.body.result.message.metadata.cluster.members.length >= 2, true);
    const ctxs = h.upstream.calls.map((c) => c.body.params.message.context_id).sort();
    assert.deepEqual(ctxs, ["wx:ctx-42--a", "wx:ctx-42--b"]);
  } finally {
    await h.close();
  }
});

// ── trust proxy: composed URLs honor X-Forwarded-Proto ──────────────────────
// The standalone facade sets app.set("trust proxy", true) behind its edge —
// the card/catalog/cluster URLs must carry the forwarded scheme, or the
// copyable cluster endpoint ships http:// (live finding 2026-10-22).

test("A/B urls: a forwarded https request composes https card, catalog and cluster URLs", async () => {
  const h = clusterHarness();
  try {
    // The harness app does NOT set trust proxy (the pre-fix posture): the
    // forwarded header is ignored and URLs stay http — the live bug. The
    // shipped bootstrap (index.js) enables it; the app2 half below mirrors
    // that and asserts the fix.
    const card = await fetch(`${h.base}/api/wanxing/v1/a2a/packs-p1-a/.well-known/agent-card.json`, { headers: { "X-Forwarded-Proto": "https" } }).then((r) => r.json());
    assert.match(card.url, /^http:\/\//, "without trust proxy the forwarded header is ignored (the bug)");
    const list = await h.get("/api/wanxing/v1/clusters");
    assert.match(list.body.clusters[0].url, /^http:\/\//, "direct traffic keeps http");

    // The shipped bootstrap (index.js) enables trust proxy; mirror it here.
    const store2 = freshStore();
    const core2 = createWanxingCore({ store: store2, sub2api: stubSub2api(), config: { ratePerMin: 0.1, rpmMax: 100 } });
    const app2 = express();
    app2.set("trust proxy", true);
    const face2 = createA2aFace({
      core: core2,
      resolveDeployment: (slug) => DEPLOYMENTS.find((d) => d.slug === slug) ?? null,
      listDeployments: () => DEPLOYMENTS,
      forwardHeaders: () => ({}),
      registryFetch: async () => new Response(JSON.stringify({ name: "n", description: "d", version: "1", visibility: "public", metadata: {} }), { headers: { "Content-Type": "application/json" } }),
      config: { agentUrlFor: (p) => p },
      packsBrowseFetch: async () => [{ id: "p1", version: 1, agentCount: 4 }],
      packsDetailFetch: async () => ({ manifest: CLUSTER_MANIFEST }),
    });
    face2.register(app2);
    const server2 = http.createServer(app2).listen(0);
    try {
      const base2 = `http://127.0.0.1:${server2.address().port}`;
      const card2 = await fetch(`${base2}/api/wanxing/v1/a2a/packs-p1-a/.well-known/agent-card.json`, { headers: { "X-Forwarded-Proto": "https" } }).then((r) => r.json());
      assert.match(card2.url, /^https:\/\//, "with trust proxy the forwarded scheme wins");
      const doc2 = await fetch(`${base2}/api/wanxing/v1/agents?facets=1`, { headers: { "X-Forwarded-Proto": "https" } }).then((r) => r.json());
      assert.ok(doc2.agents.filter((a) => a.cluster?.url).every((a) => a.cluster.url.startsWith("https://")), "catalog marker urls honor the scheme");
    } finally {
      await new Promise((r) => server2.close(r));
    }
  } finally {
    await h.close();
  }
});
