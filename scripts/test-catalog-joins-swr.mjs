#!/usr/bin/env node
// ── Catalog joins never block on snapshot expiry (catalog-joins-never-block) ─
//
// The five joins behind GET /agents used to await their upstream on TTL
// expiry, so with sporadic traffic nearly every visitor paid the cold cost
// (packs browse measured 541ms live). They now use the same
// stale-while-revalidate shape as the entry snapshot: expired → answer from
// the last value, refresh behind the request; cold → wait once.
//
//   node --test scripts/test-catalog-joins-swr.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-swr-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createSnapshotCache } = await import("../services/wanxing-facade/snapshot-cache.js");
const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore } = await import("../services/wanxing-facade/core.js");
const { createA2aFace } = await import("../services/wanxing-facade/a2a.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── helper semantics ───────────────────────────────────────────────────────

test("cold: waits for the first load exactly once", async () => {
  let loads = 0;
  const cache = createSnapshotCache({
    ttlMs: 60_000,
    fallback: new Map(),
    load: async () => { loads += 1; await sleep(120); return new Map([["a", 1]]); },
  });
  const started = Date.now();
  const first = await cache.get();
  assert.ok(Date.now() - started >= 100, "the cold read waits for the first load");
  assert.equal(first.get("a"), 1);
  await cache.get();
  assert.equal(loads, 1, "a warm read costs no load");
});

test("expired: answers from the last value and refreshes behind the request", async () => {
  let now = 1_000_000;
  let loads = 0;
  let version = 1;
  const cache = createSnapshotCache({
    ttlMs: 60_000,
    now: () => now,
    fallback: new Map(),
    load: async () => { loads += 1; const v = version; await sleep(200); return new Map([["v", v]]); },
  });
  assert.equal((await cache.get()).get("v"), 1); // cold
  version = 2;
  loads = 0;
  now += 61_000; // past the TTL
  const started = Date.now();
  const stale = await cache.get();
  assert.ok(Date.now() - started < 150, "the expired read does not wait for the 200ms refresh");
  assert.equal(stale.get("v"), 1, "the expired read carries the last-known value");
  await sleep(260); // let the background refresh land
  assert.equal(loads, 1);
  assert.equal((await cache.get()).get("v"), 2, "the next read sees the refreshed value");
});

test("expired: concurrent readers share one refresh", async () => {
  let now = 1_000_000;
  let loads = 0;
  const cache = createSnapshotCache({
    ttlMs: 60_000,
    now: () => now,
    fallback: new Map(),
    load: async () => { loads += 1; await sleep(80); return new Map([["n", loads]]); },
  });
  await cache.get(); // cold
  loads = 0;
  now += 61_000;
  await Promise.all(Array.from({ length: 12 }, () => cache.get()));
  await sleep(120);
  assert.equal(loads, 1, "12 concurrent expired readers merged into one load");
});

test("failure: a failed refresh keeps the last value; a failed first load yields the fallback", async () => {
  let now = 1_000_000;
  let fail = false;
  const cache = createSnapshotCache({
    ttlMs: 60_000,
    now: () => now,
    fallback: new Map([["fallback", true]]),
    load: async () => {
      if (fail) throw new Error("upstream down");
      return new Map([["ok", true]]);
    },
  });
  assert.equal((await cache.get()).get("ok"), true); // cold success
  fail = true;
  now += 61_000;
  assert.equal((await cache.get()).get("ok"), true, "the expired read still answers after a failed refresh");
  await sleep(20);
  assert.equal((await cache.get()).get("ok"), true, "the snapshot is not cleared by the failure");

  const coldFail = createSnapshotCache({
    ttlMs: 60_000,
    fallback: new Map([["fallback", true]]),
    load: async () => { throw new Error("upstream down"); },
  });
  assert.equal((await coldFail.get()).get("fallback"), true, "a never-loaded join degrades to its fallback");
});

// ── integration: GET /agents does not wait for an expired join ─────────────

function harness({ browseDelayMs = 0, browseRows = [] }) {
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });
  const sub2api = {
    userId: 7, email: "p@f", degraded: () => false,
    async probeKeyLiveness() { return { ok: true }; },
    async findUserByKey() { return null; },
    async findUserByEmail() { return { userId: 7, email: "p@f" }; },
    async adjustBalance() { return { ok: true }; },
  };
  const core = createWanxingCore({ store, sub2api, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const deployments = [{ slug: "packs-p1-a", agentPath: "/packs/p1/a", packId: "p1", agentId: "a", version: 1 }];
  const counts = { list: 0, browse: 0 };
  const face = createA2aFace({
    core,
    resolveDeployment: async (s) => deployments.find((d) => d.slug === s) ?? null,
    listDeployments: async () => deployments,
    hardStale: () => false,
    ensureFresh: async () => {},
    snapshotAt: () => null,
    report: null,
    forwardHeaders: () => ({}),
    registryFetch: async (p) => {
      if (p.startsWith("/api/agents?")) {
        counts.list += 1;
        return new Response(JSON.stringify({
          agents: [{ path: "/packs/p1/a", name: "A1", description: "d", visibility: "public", tags: [], skills: [], streaming: true, metadata: { packId: "p1", packVersion: 1, paused: false } }],
          total_count: 1, has_next: false,
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    },
    packsBrowseFetch: async () => {
      counts.browse += 1;
      if (browseDelayMs) await sleep(browseDelayMs);
      return browseRows;
    },
    usageTurnsByAgent: async () => new Map([["packs-p1-a", 3]]),
    chatability: () => true,
    config: { agentUrlFor: (p) => `http://up${p}/` },
    upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  const app = express();
  face.register(app);
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve({ srv, counts, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test("integration: an expired join does not hold the catalog request", async () => {
  const DELAY = 400;
  const h = await harness({ browseDelayMs: DELAY, browseRows: [{ id: "p1", category: "研究", featured: false }] });
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    const coldStart = realNow();
    const cold = await (await fetch(h.base + "/api/wanxing/v1/agents")).json();
    const coldMs = realNow() - coldStart;
    assert.equal(cold.agents[0].category, "研究", "the cold read waits for the join");
    assert.ok(coldMs >= DELAY * 0.7, `cold read waited for the join (${coldMs}ms)`);

    skew += 61_000; // past the TTL for every snapshot
    const browseBefore = h.counts.browse;
    const warmStart = realNow();
    const warm = await (await fetch(h.base + "/api/wanxing/v1/agents")).json();
    const warmMs = realNow() - warmStart;
    assert.equal(warm.agents[0].category, "研究", "the expired read carries the last-known join");
    assert.ok(warmMs < DELAY / 2, `expired read returned before the ${DELAY}ms refresh (${warmMs}ms)`);
    await sleep(60);
    assert.equal(h.counts.browse, browseBefore + 1, "the refresh ran in the background");
  } finally {
    Date.now = realNow;
    h.srv.close();
  }
});

test("integration: concurrent expiry shares one upstream refresh", async () => {
  const DELAY = 200;
  const h = await harness({ browseDelayMs: DELAY, browseRows: [{ id: "p1", category: "", featured: false }] });
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    await fetch(h.base + "/api/wanxing/v1/agents"); // cold
    skew += 61_000;
    const before = h.counts.browse;
    await Promise.all(Array.from({ length: 8 }, () => fetch(h.base + "/api/wanxing/v1/agents").then((r) => r.json())));
    await sleep(120);
    assert.equal(h.counts.browse, before + 1, "8 concurrent expired catalog reads merged into one browse");
  } finally {
    Date.now = realNow;
    h.srv.close();
  }
});
