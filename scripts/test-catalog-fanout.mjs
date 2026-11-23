#!/usr/bin/env node
// ── Registry entry snapshot (root-cause-catalog-fanout) ─────────────────────
//
// The enumeration faces (catalog, /status, console deployments) read ONE
// paginated registry list instead of one single read per deployment — and the
// snapshot they share is TTL + single-flight + stale-on-hiccup, like the
// deployment bookkeeping snapshot beside it.
//
// Measured on fd-prod 2026-11-23: 27 sequential single reads 3485ms; one list
// read of the same 45 entries 198ms; 20 concurrent catalog requests 49.9s.
//
//   node --test scripts/test-catalog-fanout.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-fanout-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore } = await import("../services/wanxing-facade/core.js");
const { createA2aFace } = await import("../services/wanxing-facade/a2a.js");

// A list row in the registry's ACTUAL list shape (fd-1.4.0, verified 45/45
// live): complete `metadata`, no `version`, no `capabilities`, flattened
// provider, skills as NAMES.
const listRow = (n, over = {}) => ({
  path: `/packs/p${n}/a`,
  name: `A${n}`,
  description: `d${n}`,
  visibility: "public",
  tags: [],
  skills: [],
  streaming: true,
  provider_organization: "paas-pack",
  provider_url: "http://100.64.0.14",
  metadata: { packId: `p${n}`, packVersion: 4, paused: false },
  ...over,
});

const mkDep = (n, over = {}) => ({ slug: `packs-p${n}-a`, agentPath: `/packs/p${n}/a`, packId: `p${n}`, agentId: "a", version: 9, ...over });

/**
 * counts.paths records every registry path the face asked for, so the tests can
 * assert the read SHAPE (one list vs N singles), not just the output.
 */
function harness({ rows = [], deployments = [], turns = {}, listStatus = 200, listDelayMs = 0, gates = {} }) {
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });
  const sub2api = {
    userId: 7, email: "platform@finddata.tech", degraded: () => false,
    async probeKeyLiveness() { return { ok: true }; },
    async findUserByKey() { return null; },
    async findUserByEmail() { return { userId: 7, email: "platform@finddata.tech" }; },
    async adjustBalance() { return { ok: true }; },
  };
  const core = createWanxingCore({ store, sub2api, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const counts = { list: 0, single: 0, paths: [] };
  let chatRef = null;
  const face = createA2aFace({
    core,
    resolveDeployment: async (slug) => deployments.find((d) => d.slug === slug) ?? null,
    listDeployments: async () => deployments,
    hardStale: () => gates.hardStale?.() ?? false,
    ensureFresh: async () => {},
    snapshotAt: () => null,
    report: null,
    forwardHeaders: () => ({}),
    registryFetch: async (p) => {
      counts.paths.push(p);
      if (p.startsWith("/api/agents?")) {
        counts.list += 1;
        if (listDelayMs) await new Promise((r) => setTimeout(r, listDelayMs));
        if (listStatus !== 200) return new Response("{}", { status: listStatus });
        return new Response(JSON.stringify({ agents: rows, total_count: rows.length, has_next: false }), { headers: { "Content-Type": "application/json" } });
      }
      counts.single += 1;
      const hit = deployments.find((d) => p === `/api/agents${d.agentPath}`);
      const row = hit ? rows.find((x) => x.path === hit.agentPath) : null;
      return new Response(row ? JSON.stringify({ ...row, version: "1", capabilities: { streaming: true }, provider: { organization: "paas-pack", url: "http://100.64.0.14" }, skills: [] }) : "{}", { status: row ? 200 : 404 });
    },
    usageTurnsByAgent: async () => new Map(Object.entries(turns)),
    chatability: (state) => (chatRef ? chatRef.chatable(state) : true),
    config: { agentUrlFor: (p) => `http://upstream${p}/` },
    upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  const app = express();
  face.register(app);
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve({ srv, counts, face, base: `http://127.0.0.1:${srv.address().port}`, store, core, setChat: (c) => { chatRef = c; } }));
  });
}

const getJson = (base, p) => fetch(base + p).then((r) => r.json());

// ── 1.1: one list read serves the whole catalog ────────────────────────────
test("catalog: N deployments cost ONE registry list read, never N single reads", async () => {
  const deployments = [mkDep(1), mkDep(2), mkDep(3), mkDep(4)];
  const rows = deployments.map((d, i) => listRow(i + 1));
  const h = await harness({ rows, deployments, turns: { "packs-p1-a": 12 } });
  try {
    const doc = await getJson(h.base, "/api/wanxing/v1/agents");
    assert.equal(doc.agents.length, 4);
    assert.equal(h.counts.list, 1, "exactly one list read for the whole catalog");
    assert.equal(h.counts.single, 0, "no per-agent reads on the enumeration path");
  } finally { h.srv.close(); }
});

// ── 1.1: concurrent readers share one refresh (single-flight) ──────────────
test("catalog: concurrent readers share ONE list refresh", async () => {
  const deployments = [mkDep(1), mkDep(2), mkDep(3)];
  const h = await harness({ rows: deployments.map((d, i) => listRow(i + 1)), deployments, listDelayMs: 40 });
  try {
    await Promise.all(Array.from({ length: 12 }, () => getJson(h.base, "/api/wanxing/v1/agents")));
    assert.equal(h.counts.list, 1, "12 concurrent catalog reads merged into one upstream list read");
  } finally { h.srv.close(); }
});

// ── 1.1: /status reads the same snapshot ───────────────────────────────────
test("/status: same snapshot, so it costs no extra upstream read", async () => {
  const deployments = [mkDep(1), mkDep(2)];
  const h = await harness({ rows: deployments.map((d, i) => listRow(i + 1)), deployments });
  try {
    await getJson(h.base, "/api/wanxing/v1/agents");
    const status = await getJson(h.base, "/api/wanxing/v1/status");
    assert.equal(status.agents.value, 2);
    assert.equal(h.counts.list, 1, "the status aggregate reuses the catalog's snapshot");
  } finally { h.srv.close(); }
});

// ── 1.3: the four synthesized fields ──────────────────────────────────────
test("synthesized fields: version from the deployment row, capabilities from streaming, provider unflattened", async () => {
  const dep = mkDep(1, { version: 9 }); // registry row says packVersion 4, entry.version "1"
  const h = await harness({ rows: [listRow(1)], deployments: [dep] });
  try {
    const doc = await getJson(h.base, "/api/wanxing/v1/agents");
    const a = doc.agents[0];
    assert.equal(a.version, "9", "published pack version comes from the deployment row, not the stale entry.version");
    assert.deepEqual(a.capabilities, { streaming: true });
    const card = await getJson(h.base, `/api/wanxing/v1/a2a/${dep.slug}/.well-known/agent-card.json`);
    assert.equal(card.version, "9", "the card and the catalog agree on the version");
  } finally { h.srv.close(); }
});

test("synthesized fields: a non-streaming row gets an empty capabilities object, and a private URL keeps its redaction", async () => {
  const dep = mkDep(1);
  const h = await harness({
    rows: [listRow(1, { streaming: false, provider_url: "http://100.64.0.14" })],
    deployments: [dep],
  });
  try {
    const a = (await getJson(h.base, "/api/wanxing/v1/agents")).agents[0];
    assert.deepEqual(a.capabilities, {});
    const card = await getJson(h.base, `/api/wanxing/v1/a2a/${dep.slug}/.well-known/agent-card.json`);
    assert.equal(card.provider.organization, "paas-pack");
    assert.equal(card.provider.url, undefined, "a CGNAT provider url is dropped, not rewritten");
  } finally { h.srv.close(); }
});

// ── 1.2: pagination + hostile registries ──────────────────────────────────
test("pagination: a multi-page registry is followed to exhaustion", async () => {
  const deployments = Array.from({ length: 3 }, (_, i) => mkDep(i + 1));
  // A page-1-only stub would hide two entries; the walk must continue.
  let page = 0;
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });
  const sub2api = { userId: 7, email: "p@f", degraded: () => false, async probeKeyLiveness() { return { ok: true }; }, async findUserByKey() { return null; }, async findUserByEmail() { return { userId: 7, email: "p@f" }; }, async adjustBalance() { return { ok: true }; } };
  const core = createWanxingCore({ store, sub2api, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const face = createA2aFace({
    core, resolveDeployment: async (s) => deployments.find((d) => d.slug === s) ?? null, listDeployments: async () => deployments,
    hardStale: () => false, ensureFresh: async () => {}, report: null, forwardHeaders: () => ({}) ,
    registryFetch: async (p) => {
      if (p.startsWith("/api/agents?")) {
        page += 1;
        const all = deployments.map((d, i) => listRow(i + 1));
        const rows = page === 1 ? all.slice(0, 2) : all.slice(2);
        return new Response(JSON.stringify({ agents: rows, total_count: 3, has_next: page === 1 }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    },
    chatability: () => true, config: { agentUrlFor: (p) => `http://up${p}/` }, upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  const app = express(); face.register(app);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try {
    const doc = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/wanxing/v1/agents`)).json();
    assert.equal(doc.agents.length, 3, "both pages are read, none silently dropped");
    assert.equal(page, 2);
  } finally { srv.close(); }
});

// ── 1.4: the write path keeps its single read ─────────────────────────────
test("write path: pausing still reads the full entry one at a time (the snapshot must not feed a PUT)", async () => {
  const dep = mkDep(1);
  const h = await harness({ rows: [listRow(1)], deployments: [dep] });
  try {
    await getJson(h.base, "/api/wanxing/v1/agents"); // warm the snapshot
    const before = h.counts.single;
    // setPaused lives on the console face; assert the primitive it uses is
    // still the single read by driving agentState directly (the card face).
    const state = await h.face.agentState(dep.slug);
    assert.equal(h.counts.single, before + 1, "the card face reads one entry in full");
    assert.ok(state.entry.skills, "the full entry (skills etc.) is present for a PUT-shaped write");
  } finally { h.srv.close(); }
});

// ── degraded: a registry without the list face must not blank the catalog ──
test("degrade: a failing list read falls back to per-agent reads", async () => {
  const deployments = [mkDep(1), mkDep(2)];
  const h = await harness({ rows: deployments.map((d, i) => listRow(i + 1)), deployments, listStatus: 500 });
  try {
    const doc = await getJson(h.base, "/api/wanxing/v1/agents");
    assert.equal(doc.agents.length, 2, "the catalog still serves via the fallback");
    assert.equal(h.counts.single, 2, "the fallback read one entry per deployment");
  } finally { h.srv.close(); }
});

// ── the SAME herd problem one layer down: packs browse ────────────────────
test("catalog: concurrent readers share ONE packs browse (the 541ms upstream hop)", async () => {
  const deployments = [mkDep(1), mkDep(2), mkDep(3)];
  const rows = deployments.map((d, i) => listRow(i + 1));
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });
  const sub2api = { userId: 7, email: "p@f", degraded: () => false, async probeKeyLiveness() { return { ok: true }; }, async findUserByKey() { return null; }, async findUserByEmail() { return { userId: 7, email: "p@f" }; }, async adjustBalance() { return { ok: true }; } };
  const core = createWanxingCore({ store, sub2api, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  let browses = 0;
  const face = createA2aFace({
    core, resolveDeployment: async (s) => deployments.find((d) => d.slug === s) ?? null, listDeployments: async () => deployments,
    hardStale: () => false, ensureFresh: async () => {}, report: null, forwardHeaders: () => ({}),
    registryFetch: async (p) => (p.startsWith("/api/agents?")
      ? new Response(JSON.stringify({ agents: rows, total_count: rows.length, has_next: false }), { headers: { "Content-Type": "application/json" } })
      : new Response("{}", { status: 404 })),
    packsBrowseFetch: async () => {
      browses += 1;
      await new Promise((r) => setTimeout(r, 30));
      return deployments.map((d) => ({ id: d.packId, category: "legal", featured: false, agentCount: 1 }));
    },
    packsDetailFetch: async () => ({ manifest: {} }),
    chatability: () => true, config: { agentUrlFor: (p) => `http://up${p}/` }, upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  const app = express(); face.register(app);
  const srv = app.listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  try {
    await Promise.all(Array.from({ length: 12 }, () => fetch(`http://127.0.0.1:${srv.address().port}/api/wanxing/v1/agents`).then((r) => r.json())));
    assert.equal(browses, 1, "12 concurrent catalog reads must share one packs browse, not issue 12");
  } finally { srv.close(); }
});
