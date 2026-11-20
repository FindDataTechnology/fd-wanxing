#!/usr/bin/env node
// ── External-system requirements on the 萬星 catalog ─────────────────────────
//    (surface-connector-requirements-in-wanxing)
//
// 萬星 is the deployment face, so it is where a deployer asks "is this agent
// actually able to run?" — and today it says nothing about the external systems
// the agent needs. Both halves of that answer already exist and neither needs a
// new paas field:
//
//   declaration  packsDetailFetch(packId).manifest.connector_bindings
//   wiring       registryEntry.metadata.connector_bindings  (paas composes the
//                entry's metadata FROM THE DESCRIPTOR, which only carries
//                bindings the deploy actually minted)
//
// The tests below pin the join, and — more importantly — the three facts that
// must not blur: undeclared (absent key), all-wired (empty `missing`), and
// could-not-ask (absent key, NOT an empty gap list, which would claim "all
// wired"). `optional` rides along because paas never mints an optional
// binding, so a gap list that hides the flag sends someone to fix something
// that cannot change.
//
//   node --test scripts/test-connector-requirements.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { test } from "node:test";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-connector-req-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore } = await import("../services/wanxing-facade/core.js");
const { createA2aFace } = await import("../services/wanxing-facade/a2a.js");

const mkEntry = (over = {}) => ({
  name: "A",
  description: "d",
  version: "1",
  visibility: "public",
  tags: [],
  skills: [],
  capabilities: { streaming: true },
  metadata: {},
  ...over,
});

/**
 * @param deployments [{ slug, agentPath, packId }]
 * @param entries     slug → registry entry
 * @param details     packId → packs-detail body (or "throws")
 * @param counters    mutable object recording how many detail reads happened
 */
async function harness({ deployments, entries, details = {}, counters = { detailReads: 0 }, browseCounts = {}, includeInBrowse = true }) {
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });
  const sub2api = {
    userId: 7,
    email: "platform@finddata.tech",
    degraded: () => false,
    async probeKeyLiveness() {
      return { ok: true };
    },
    async findUserByKey() {
      return null;
    },
    async findUserByEmail() {
      return { userId: 7, email: "platform@finddata.tech" };
    },
    async adjustBalance() {
      return { ok: true };
    },
  };
  const core = createWanxingCore({ store, sub2api, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const deps = deployments.map((d) => ({ slug: d.slug, agentPath: d.agentPath, packId: d.packId ?? null }));
  const face = createA2aFace({
    core,
    resolveDeployment: async (slug) => deployments.find((d) => d.slug === slug) ?? null,
    listDeployments: async () => deps,
    hardStale: () => false,
    ensureFresh: async () => {},
    snapshotAt: () => Date.parse("2026-11-20T03:00:00.000Z"),
    report: null,
    forwardHeaders: () => ({}),
    registryFetch: async (p) => {
      const hit = deps.find((d) => p === `/api/agents${d.agentPath}`);
      const entry = hit ? entries[hit.slug] : null;
      return new Response(entry ? JSON.stringify(entry) : "{}", { status: entry ? 200 : 404 });
    },
    usageTurnsByAgent: async () => new Map(),
    chatability: () => true,
    // The gate reads the BROWSE row's connectorBindingCount: a pack that
    // declares bindings but minted none is precisely the case this projection
    // exists to show, so the gate cannot come from the deployed wiring.
    packsBrowseFetch: async () => (includeInBrowse ? deployments.map((d) => ({ id: d.packId, agentCount: 1, connectorBindingCount: browseCounts[d.packId] ?? 0 })) : []),
    packsDetailFetch: async (id) => {
      counters.detailReads += 1;
      const detail = details[id];
      if (detail === "throws") throw new Error("packs internal API unreachable");
      if (detail === undefined) throw Object.assign(new Error("not found"), { code: "PACKS_INTERNAL_UNAVAILABLE" });
      return detail;
    },
    config: { agentUrlFor: (p) => `http://upstream${p}/` },
    upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  const app = express();
  face.register(app);
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const detailWith = (bindings) => ({ manifest: { connector_bindings: bindings } });

async function catalogEntry(base, slug) {
  const body = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
  return body.agents.find((a) => a.slug === slug);
}

test("all declared bindings wired: the gap list is empty and the numbers agree", async () => {
  const { srv, base } = await harness({
    deployments: [{ slug: "alpha", agentPath: "/agents/alpha", packId: "p1" }],
    browseCounts: { p1: 2 },
    entries: {
      alpha: mkEntry({
        metadata: { connector_bindings: [{ key: "erp", serverName: "s1" }, { key: "wms", serverName: "s2" }] },
      }),
    },
    details: { p1: detailWith([{ key: "erp" }, { key: "wms" }]) },
  });
  try {
    const e = await catalogEntry(base, "alpha");
    assert.deepEqual(e.external_systems, { declared: 2, required: 2, wired: 2, missing: [] });
    // The wiring half must never leak what it is: serverName/url/secretName
    // belong to the deployment, not to a public catalog.
    const serialized = JSON.stringify(e);
    for (const forbidden of ["serverName", "secretName", "s1", "s2", "mcp"]) {
      assert.equal(serialized.includes(forbidden), false, `projection leaked ${forbidden}`);
    }
  } finally {
    srv.close();
  }
});

test("a partial deployment reports exactly the unminted keys, with their optional flag", async () => {
  const { srv, base } = await harness({
    deployments: [{ slug: "beta", agentPath: "/agents/beta", packId: "p2" }],
    browseCounts: { p2: 3 },
    entries: { beta: mkEntry({ metadata: { connector_bindings: [{ key: "erp" }] } }) },
    details: {
      p2: detailWith([{ key: "erp" }, { key: "wms" }, { key: "pos", optional: true }]),
    },
  });
  try {
    const e = await catalogEntry(base, "beta");
    assert.equal(e.external_systems.declared, 3);
    assert.equal(e.external_systems.required, 2, "the optional binding is not a requirement to close");
    assert.equal(e.external_systems.wired, 1);
    assert.deepEqual(e.external_systems.missing, [
      { key: "wms", optional: false },
      { key: "pos", optional: true },
    ]);
  } finally {
    srv.close();
  }
});

test("an all-optional pack is wired=0 with every gap marked optional", async () => {
  // The documented trap: paas's mintableBindings() filters `!row.optional`, so
  // an all-optional pack can NEVER mint a deploy PAT. Saying "2 gaps" without
  // the flag would send the deployer to fix something that cannot change.
  const { srv, base } = await harness({
    deployments: [{ slug: "gamma", agentPath: "/agents/gamma", packId: "p3" }],
    browseCounts: { p3: 2 },
    entries: { gamma: mkEntry() },
    details: { p3: detailWith([{ key: "pos", optional: true }, { key: "pay", optional: true }]) },
  });
  try {
    const e = await catalogEntry(base, "gamma");
    assert.equal(e.external_systems.required, 0);
    assert.equal(e.external_systems.wired, 0);
    assert.deepEqual(
      e.external_systems.missing.map((m) => m.optional),
      [true, true],
    );
  } finally {
    srv.close();
  }
});

test("a pack MISSING from the browse listing still gets its detail read", async () => {
  // Found on production 2026-11-20: the shelf had 156 packs, the browse call
  // returns 100, and the probe pack sat on page 2 — so the gate never saw it and
  // the catalog silently said "undeclared". Absence from the listing is not
  // evidence of absence: only a LISTED row with a zero count may skip the read.
  const counters = { detailReads: 0 };
  const { srv, base } = await harness({
    deployments: [{ slug: "unlisted", agentPath: "/agents/unlisted", packId: "p20" }],
    entries: { unlisted: mkEntry({ metadata: { connector_bindings: [{ key: "erp" }] } }) },
    details: { p20: detailWith([{ key: "erp" }, { key: "wms" }]) },
    // The pack is NOT in the browse listing at all (page cap / private).
    browseCounts: {},
    includeInBrowse: false,
    counters,
  });
  try {
    const e = await catalogEntry(base, "unlisted");
    assert.ok(counters.detailReads >= 1, "an unlisted pack must still be detailed");
    assert.deepEqual(e.external_systems, {
      declared: 2,
      required: 2,
      wired: 1,
      missing: [{ key: "wms", optional: false }],
    });
  } finally {
    srv.close();
  }
});

test("a LISTED pack with zero bindings skips the read (the cheap gate still works)", async () => {
  const counters = { detailReads: 0 };
  const { srv, base } = await harness({
    deployments: [{ slug: "plain", agentPath: "/agents/plain", packId: "p21" }],
    entries: { plain: mkEntry() },
    details: { p21: detailWith([{ key: "erp" }]) },
    browseCounts: { p21: 0 },
    counters,
  });
  try {
    const e = await catalogEntry(base, "plain");
    assert.equal("external_systems" in e, false);
    assert.equal(counters.detailReads, 0, "a listed zero-count pack must not cost a detail read");
  } finally {
    srv.close();
  }
});

test("an undeclared pack carries NO key — never declared:0", async () => {
  const { srv, base } = await harness({
    deployments: [{ slug: "delta", agentPath: "/agents/delta", packId: "p4" }],
    browseCounts: { p4: 0 },
    entries: { delta: mkEntry() },
    details: { p4: { manifest: {} } },
  });
  try {
    const e = await catalogEntry(base, "delta");
    assert.equal("external_systems" in e, false, "undeclared must be absent, not a zero");
  } finally {
    srv.close();
  }
});

test("a failed declaration read is absent — NOT an empty gap list", async () => {
  const counters = { detailReads: 0 };
  const { srv, base } = await harness({
    deployments: [{ slug: "eps", agentPath: "/agents/eps", packId: "p5" }],
    browseCounts: { p5: 1 },
    // The deployment shows wiring, but the pack surface is down: we cannot
    // know what was declared, so we must say nothing rather than "all wired".
    entries: { eps: mkEntry({ metadata: { connector_bindings: [{ key: "erp" }] } }) },
    details: { p5: "throws" },
    counters,
  });
  try {
    const e = await catalogEntry(base, "eps");
    assert.equal("external_systems" in e, false, "an outage is not a claim that everything is wired");
  } finally {
    srv.close();
  }
});

test("a deployment carrying a binding this version no longer declares keeps wired <= declared", async () => {
  const { srv, base } = await harness({
    deployments: [{ slug: "zeta", agentPath: "/agents/zeta", packId: "p6" }],
    browseCounts: { p6: 1 },
    // Minted under an older version: 'legacy' is no longer declared.
    entries: { zeta: mkEntry({ metadata: { connector_bindings: [{ key: "erp" }, { key: "legacy" }] } }) },
    details: { p6: detailWith([{ key: "erp" }]) },
  });
  try {
    const e = await catalogEntry(base, "zeta");
    assert.equal(e.external_systems.declared, 1);
    assert.equal(e.external_systems.wired, 1, "wired counts against the declaration, not the minted set");
    assert.deepEqual(e.external_systems.missing, []);
  } finally {
    srv.close();
  }
});

test("the detail read is cached: two catalog reads, one packs read", async () => {
  const counters = { detailReads: 0 };
  const { srv, base } = await harness({
    deployments: [{ slug: "eta", agentPath: "/agents/eta", packId: "p7" }],
    browseCounts: { p7: 1 },
    entries: { eta: mkEntry() },
    details: { p7: detailWith([{ key: "erp" }]) },
    counters,
  });
  try {
    await catalogEntry(base, "eta");
    const afterFirst = counters.detailReads;
    await catalogEntry(base, "eta");
    assert.equal(counters.detailReads, afterFirst, "the second read must come from the cache");
    assert.ok(afterFirst >= 1, "the first read must actually have happened");
  } finally {
    srv.close();
  }
});

test("the per-agent card carries the same projection", async () => {
  const { srv, base } = await harness({
    deployments: [{ slug: "theta", agentPath: "/agents/theta", packId: "p8" }],
    browseCounts: { p8: 2 },
    entries: { theta: mkEntry({ metadata: { connector_bindings: [{ key: "erp" }] } }) },
    details: { p8: detailWith([{ key: "erp" }, { key: "wms" }]) },
  });
  try {
    const card = await (
      await fetch(`${base}/api/wanxing/v1/a2a/theta/.well-known/agent-card.json`)
    ).json();
    assert.deepEqual(card.external_systems, {
      declared: 2,
      required: 2,
      wired: 1,
      missing: [{ key: "wms", optional: false }],
    });
  } finally {
    srv.close();
  }
});
