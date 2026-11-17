#!/usr/bin/env node
// ── Three pillars on the public catalog (openspec unify-pillar-surfaces 3.2) ──
//
// The 萬星 catalog (`GET /api/wanxing/v1/agents`) is an ANONYMOUS machine face.
// The spec's rule for it is: contract facts yes, author prose no. So the entry
// carries the declared memory axes and the narrowed tool names, and never the
// charter text (`memory.guidance`), persona, skill or guide bodies.
//
// Absent metadata must mean absent keys — this face may not invent a default
// (unknown != zero, the same rule the derivation is held to). And whatever it
// emits must be DECLARED in contracts/wanxing-public-api.v1.json, otherwise
// the coverage assertion in test-public-contract.mjs fails.
//
//   node --test scripts/test-catalog-pillars.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), "wx-pillars-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { loadContract } = await import("./lib/contract-check.mjs");
const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore } = await import("../services/wanxing-facade/core.js");
const { createA2aFace } = await import("../services/wanxing-facade/a2a.js");

const contract = loadContract(path.join(HERE, "..", "contracts", "wanxing-public-api.v1.json"));

const AXES = {
  store: { home: "member" },
  read: { scope: "own+shared" },
  write: { authority: "private" },
  process: { distill: "on" },
};
const CHARTER = "记：只记本周期的四类读数；不记被评方的正文。写：每轮收口写一次。";

const mkEntry = (over = {}) => ({
  name: "A", description: "d", version: "1", visibility: "public",
  tags: ["t"], skills: [], capabilities: { streaming: true }, metadata: {}, ...over,
});

async function harness({ deployments, entries }) {
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
    usageTurnsByAgent: async () => new Map(),
    chatability: () => true,
    config: { agentUrlFor: (p) => `http://upstream${p}/` },
    upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  const app = express();
  face.register(app);
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const one = (slug) => [{ slug, agentPath: `/agents/${slug}` }];

test("declared pillars ride the catalog entry — axes and tool names, no prose", async () => {
  const entry = mkEntry({
    metadata: {
      mcpTools: { "invest-ops-mcp": ["fleet_list", "fleet_spec_read"] },
      memory: { ...AXES, guidance: CHARTER },
    },
  });
  const { srv, base } = await harness({ deployments: one("alpha"), entries: { alpha: entry } });
  try {
    const body = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const e = body.agents.find((x) => x.slug === "alpha");
    assert.deepEqual(e.toolFace, { "invest-ops-mcp": ["fleet_list", "fleet_spec_read"] },
      "toolFace must ride the entry verbatim");
    assert.deepEqual(e.memory, AXES, "memory must carry the four axes and nothing else");
    assert.equal("guidance" in e.memory, false, "charter prose must not ride an anonymous face");
    assert.equal(JSON.stringify(body).includes(CHARTER), false,
      "the anonymous catalog body must not contain the charter text at all");
    // Contract coverage: every emitted key has to be declared.
    assert.deepEqual(contract.coverage("catalogEntry", e), [], "catalog emits undeclared fields");
  } finally {
    srv.close();
  }
});

test("undeclared pillars are ABSENT, not empty shells", async () => {
  const { srv, base } = await harness({
    deployments: [{ slug: "beta", agentPath: "/agents/beta" }, { slug: "gamma", agentPath: "/agents/gamma" }],
    entries: {
      beta: mkEntry(),
      // Only a charter: a memory declaration with no axis value anywhere.
      gamma: mkEntry({ metadata: { memory: { guidance: CHARTER } } }),
    },
  });
  try {
    const body = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const beta = body.agents.find((x) => x.slug === "beta");
    const gamma = body.agents.find((x) => x.slug === "gamma");
    for (const [name, e] of [["beta", beta], ["gamma", gamma]]) {
      assert.equal("toolFace" in e, false, `${name}: no declared tools => no toolFace key`);
      assert.equal("memory" in e, false, `${name}: no declared axes => no memory key`);
      assert.deepEqual(contract.coverage("catalogEntry", e), [], `${name}: undeclared fields`);
    }
  } finally {
    srv.close();
  }
});
