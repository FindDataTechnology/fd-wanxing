#!/usr/bin/env node
// ── Producer-side contract conformance ──────────────────────────────────────
//
// close-wanxing-domain-linkage 1.x/6.3: every public read face that a sibling
// line consumes is validated against the SHAPE DECLARED in
// contracts/wanxing-public-api.v1.json. The test drives the real routes, so a
// renamed/removed field fails here rather than in another repo's production.
//
//   node --test scripts/test-public-contract.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-contract-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT = path.join(HERE, "..", "contracts", "wanxing-public-api.v1.json");

const { loadContract } = await import("./lib/contract-check.mjs");
const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore } = await import("../services/wanxing-facade/core.js");
const { createA2aFace } = await import("../services/wanxing-facade/a2a.js");
const { createObserver } = await import("../services/fleet-observer/observer.js");
const http = await import("node:http");

const contract = loadContract(CONTRACT);

const mkEntry = (over = {}) => ({
  name: "A", description: "d", version: "1", visibility: "public",
  tags: ["t"], skills: [], capabilities: { streaming: true }, metadata: {}, ...over,
});

function harness({ deployments, entries, turns = {} }) {
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });
  const sub2api = {
    userId: 7, email: "platform@finddata.tech", degraded: () => false,
    async probeKeyLiveness() { return { ok: true }; },
    async findUserByKey() { return null; },
    async findUserByEmail() { return { userId: 7, email: "platform@finddata.tech" }; },
    async adjustBalance() { return { ok: true }; },
  };
  const core = createWanxingCore({ store, sub2api, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const deps = deployments.map((d) => ({ slug: d.slug, agentPath: d.agentPath, packId: d.packId ?? null }));
  const face = createA2aFace({
    core,
    resolveDeployment: async (slug) => deployments.find((d) => d.slug === slug) ?? null,
    listDeployments: async () => deps,
    hardStale: () => false,
    ensureFresh: async () => {},
    snapshotAt: () => Date.parse("2026-11-13T03:00:00.000Z"),
    report: null,
    forwardHeaders: () => ({}),
    registryFetch: async (p) => {
      const hit = deps.find((d) => p === `/api/agents${d.agentPath}`);
      const entry = hit ? entries[hit.slug] : null;
      return new Response(entry ? JSON.stringify(entry) : "{}", { status: entry ? 200 : 404 });
    },
    usageTurnsByAgent: async () => new Map(Object.entries(turns)),
    chatability: () => true,
    config: { agentUrlFor: (p) => `http://upstream${p}/` },
    upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  const app = express();
  face.register(app);
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}`, store }));
  });
}

test("contract: the file declares a revision and the surfaces consumers depend on", () => {
  assert.equal(typeof contract.rev, "string");
  assert.match(contract.rev, /^\d+$/);
  for (const surface of ["agentsResponse", "catalogEntry", "opsUsageResponse", "fleetBoardResponse", "turnReceipt"]) {
    assert.ok(contract.doc.$defs?.[surface], `contract surface missing: ${surface}`);
  }
});

test("contract: GET /agents conforms — full list and paged+facets form", async () => {
  const dep1 = { slug: "packs-p1-a", agentPath: "/packs/p1/deployments/a", packId: "p1" };
  const dep2 = { slug: "packs-p2-a", agentPath: "/packs/p2/deployments/a", packId: "p2" };
  const { srv, base } = await harness({
    deployments: [dep1, dep2],
    entries: {
      [dep1.slug]: mkEntry({ metadata: { facade: { stance: "hosted" } } }),
      [dep2.slug]: mkEntry({ metadata: { paused: true } }),
    },
    turns: { [dep1.slug]: 5 },
  });
  try {
    const full = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    assert.deepEqual(contract.check("agentsResponse", full), [], "full catalog violates the contract");
    for (const e of full.agents) {
      assert.deepEqual(contract.check("catalogEntry", e), [], `entry ${e.slug} violates the contract`);
    }

    const paged = await (await fetch(`${base}/api/wanxing/v1/agents?page=1&page_size=1&facets=1`)).json();
    assert.deepEqual(contract.check("agentsResponse", paged), [], "paged catalog violates the contract");

    // Coverage (not just conformance): every key the face EMITS must be declared.
    // `validate()` cannot see undeclared keys, which is how `facets.clusters`
    // shipped undocumented. Both request shapes, because facets only appear when
    // asked for and the bare shape is the one most consumers use.
    for (const [label, payload] of [["bare", full], ["paged+facets", paged]]) {
      assert.deepEqual(contract.coverage("agentsResponse", payload), [],
        `the ${label} catalog emits undeclared fields`);
      for (const e of payload.agents) {
        assert.deepEqual(contract.coverage("catalogEntry", e), [],
          `entry ${e.slug} emits undeclared fields`);
      }
    }
  } finally {
    srv.close();
  }
});

test("contract: the ops/usage payload conforms (the exact object the route serves)", async () => {
  // The route is `res.json(store.usageBoard())`, and it lives on
  // registerWanxingRoutes (not on the a2a face), so the honest producer-side
  // check is the payload itself — plus the gate, covered by
  // scripts/test-wanxing-facade.mjs.
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "u-")), "wanxing.db") });
  const board = store.usageBoard();
  assert.deepEqual(contract.check("opsUsageResponse", board), [], "usageBoard() violates the contract");
    assert.deepEqual(contract.coverage("opsUsageResponse", board), [], "usageBoard() emits undeclared fields");

  // with a row present, the same guarantee holds
  const t = Date.now();
  store.usageInsert({
    id: "wu_contract_1", callerId: 7, callerEmail: "owner@finddata.tech",
    agentSlug: "packs-p1-a", idemKey: "k1",
    startedAt: t, endedAt: t + 1000, durationMs: 1000,
    outcome: "ok", minutesBilled: 2, rateUsd: 0.1, settlementStatus: "settled",
    channel: "api", settler: "caller",
  });
  assert.deepEqual(contract.check("opsUsageResponse", store.usageBoard()), [], "populated usageBoard() violates the contract");
  assert.deepEqual(contract.coverage("opsUsageResponse", store.usageBoard()), [], "populated usageBoard() emits undeclared fields");
});

test("contract: a renamed consumed field is caught (the checker can actually fail)", () => {
  // Positive control: the checker must reject a payload that drops `slug`,
  // which is the field the supply spine joins its bookkeeping on.
  const bad = { agents: [{ name: "x", description: "y" }] };
  const errs = contract.check("agentsResponse", bad);
  assert.ok(errs.some((e) => e.includes("slug")), `expected a slug error, got: ${JSON.stringify(errs)}`);

  // And a wrong status vocabulary must be rejected.
  const badStatus = { agents: [{ slug: "s", name: "n", description: "d", status: "running" }] };
  const e2 = contract.check("agentsResponse", badStatus);
  assert.ok(e2.some((x) => x.includes("status")), `expected a status enum error, got: ${JSON.stringify(e2)}`);
});

test("contract: GET /api/fleet/v1/board conforms (the field set ops-console renders)", async () => {
  // Long intervals: the observer owns a rollup interval and a sub2api pull
  // interval, both of which keep the event loop alive. The observer tests pass
  // a huge poll interval for the same reason — without it `node --test` waits
  // for the handle and the whole suite hangs.
  const obs = createObserver({
    dataRoot: path.join(mkdtempSync(path.join(tmp, "b-")), "d"),
    ingestToken: "tok",
    now: () => 1_800_001_234_567,
    pollIntervalMs: 10 ** 9,
    rollupIntervalMs: 10 ** 9,
  });
  const srv = http.createServer(obs.app);
  const base = await new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${srv.address().port}`)),
  );
  try {
    const denied = await fetch(`${base}/api/fleet/v1/board`);
    assert.equal(denied.status, 401, "the board must stay credential-only");

    const r = await fetch(`${base}/api/fleet/v1/board`, { headers: { authorization: "Bearer tok" } });
    assert.equal(r.status, 200);
    const board = await r.json();
    assert.deepEqual(contract.check("fleetBoardResponse", board), [], "board violates the contract");
    assert.deepEqual(contract.coverage("fleetBoardResponse", board), [],
      "the board emits undeclared fields (ops-console may be the only reader of one)");
    // the exact fields ops-console reads must all be present
    for (const k of ["states", "runners", "ingest_lag", "settled_pending", "wake_ms"]) {
      assert.ok(k in board, `ops-console field missing from the board: ${k}`);
    }
  } finally {
    srv.close();
    obs.close(); // clear the observer's timers so the test file can exit
  }
});
