#!/usr/bin/env node
// ── Catalog instance status + chatability agreement ─────────────────────────
//
// close-wanxing-domain-linkage 2.2/2.3/2.5/2.6:
//   · the public catalog reports a live instance status derived ONLY from the
//     pause flag + the 7-day turn count (+ snapshot staleness), with
//     status_as_of naming the snapshot it used;
//   · the fields are purely additive (the pre-change field union is preserved);
//   · the chatability marker uses the REAL pause state — the old code passed a
//     literal `paused: false`, so a paused agent was advertised as chatable
//     while /chat/:slug/status answered "agent_paused".
//
//   node --test scripts/test-catalog-status.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-catalog-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore, statusFor, INSTANCE_STATUSES } = await import("../services/wanxing-facade/core.js");
const { createA2aFace } = await import("../services/wanxing-facade/a2a.js");
const { createChatFace } = await import("../services/wanxing-facade/chat.js");

// ── statusFor: the truth table, as a pure function ──────────────────────────
test("statusFor: the four declared values, pause winning over staleness", () => {
  assert.deepEqual(INSTANCE_STATUSES, ["serving", "idle", "paused", "unknown"]);

  // paused (regardless of turns / staleness) — a known administrative state
  assert.equal(statusFor({ paused: true, turns7d: 0 }), "paused");
  assert.equal(statusFor({ paused: true, turns7d: 99 }), "paused");
  assert.equal(statusFor({ paused: true, hardStale: true }), "paused");

  // silence is NOT health
  assert.equal(statusFor({ paused: false, turns7d: 0 }), "idle");

  // activity is serving
  assert.equal(statusFor({ paused: false, turns7d: 1 }), "serving");

  // a stale snapshot is genuinely unknown, not "last known serving"
  assert.equal(statusFor({ paused: false, turns7d: 12, hardStale: true }), "unknown");
  assert.equal(statusFor({ paused: false, turns7d: 0, hardStale: true }), "unknown");

  // defaults never claim health
  assert.equal(statusFor(), "idle");
});

// ── Harness: a2a face + chat face wired exactly like routes.js ─────────────
const depSlugOf = (d) => d.slug;

function harness({ deployments, entries, turns = {}, hardStale = false, snapshotAt = null, subsidyEnabled = false, hostLimitMinutes = 0, curation = null }) {
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });
  // A live (non-degraded) sub2api + a platform subsidy identity make subsidyOpen()
  // true; a host allowance row makes hostRemaining(slug) > 0. Both are the REAL
  // gate inputs, not test-only overrides.
  const sub2api = {
    userId: 7,
    email: "platform@finddata.tech",
    degraded: () => false,
    async probeKeyLiveness() { return { ok: true }; },
    async findUserByKey() { return null; },
    async findUserByEmail() { return { userId: 7, email: "platform@finddata.tech" }; },
    async adjustBalance() { return { ok: true }; },
  };
  const core = createWanxingCore({ store, sub2api, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const deps = deployments.map((d) => ({ slug: d.slug, agentPath: d.agentPath, packId: d.packId ?? null, agentId: d.agentId ?? null }));
  let chatRef = null;

  const face = createA2aFace({
    core,
    resolveDeployment: async (slug) => deployments.find((d) => d.slug === slug) ?? null,
    listDeployments: async () => deps,
    hardStale: () => hardStale,
    ensureFresh: async () => {},
    snapshotAt: () => snapshotAt,
    report: null,
    forwardHeaders: () => ({}),
    registryFetch: async (p) => {
      const hit = deps.find((d) => p === `/api/agents${d.agentPath}`);
      const entry = hit ? entries[hit.slug] : null;
      return new Response(entry ? JSON.stringify(entry) : "{}", { status: entry ? 200 : 404 });
    },
    usageTurnsByAgent: async () => new Map(Object.entries(turns)),
    ...(curation !== null ? { packsBrowseFetch: async () => curation } : {}),
    chatability: (state) => (chatRef ? chatRef.chatable(state) : true),
    config: { agentUrlFor: (p) => `http://upstream${p}/` },
    upstreamFetch: async () => new Response("{}", { status: 200 }),
  });

  const chatFace = createChatFace({
    core,
    store,
    logto: { configured: false, verifyIdToken: async () => null },
    agentState: (slug) => face.agentState(slug),
    resolveDeployment: async (slug) => deployments.find((d) => d.slug === slug) ?? null,
    forwardHeaders: () => ({}),
    hostSettle: async () => ({ settled: true, duplicate: false }),
    sub2api,
    subsidyKey: subsidyEnabled ? "sk-platform" : null,
    subsidyUserId: subsidyEnabled ? 7 : null,
    chat: { rpmMax: 100, subsidyEnabled },
    config: { agentUrlFor: (p) => `http://upstream${p}/` },
    upstreamFetch: async () => new Response("{}", { status: 200 }),
  });
  chatRef = chatFace;
  if (hostLimitMinutes > 0) store.hostAllowanceSet(depSlugOf(deployments[0]), hostLimitMinutes, "test@finddata.tech");

  const app = express();
  face.register(app);
  chatFace.register(app);
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

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

const mkDep = (n, over = {}) => ({ slug: `packs-p${n}-a`, agentPath: `/packs/p${n}/deployments/a`, packId: `p${n}`, ...over });

// ── 2.2: status + status_as_of on every entry ─────────────────────────────
test("2.2 catalog: derived status per entry, status_as_of from the snapshot", async () => {
  const dep1 = mkDep(1), dep2 = mkDep(2), dep3 = mkDep(3);
  const snapAt = Date.parse("2026-11-13T02:00:00.000Z");
  const { srv, base } = await harness({
    deployments: [dep1, dep2, dep3],
    entries: {
      [dep1.slug]: mkEntry(),
      [dep2.slug]: mkEntry(),
      [dep3.slug]: mkEntry({ metadata: { paused: true } }),
    },
    turns: { [dep1.slug]: 7 },
    snapshotAt: snapAt,
  });
  try {
    const doc = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const by = Object.fromEntries(doc.agents.map((a) => [a.slug, a]));

    assert.equal(by[dep1.slug].status, "serving"); // has turns
    assert.equal(by[dep2.slug].status, "idle");    // silence is not health
    assert.equal(by[dep3.slug].status, "paused");  // pause wins
    for (const a of doc.agents) {
      assert.equal(a.status_as_of, "2026-11-13T02:00:00.000Z");
    }
  } finally {
    srv.close();
  }
});

test("2.2 catalog: past the hard window the face degrades; it never reports a stale status as current", async () => {
  const dep = mkDep(1);
  const snapAt = Date.parse("2026-11-13T01:00:00.000Z");
  const { srv, base } = await harness({
    deployments: [dep],
    entries: { [dep.slug]: mkEntry() },
    turns: { [dep.slug]: 42 }, // would read "serving" if we trusted the stale snapshot
    hardStale: true,
    snapshotAt: snapAt,
  });
  try {
    const r = await fetch(`${base}/api/wanxing/v1/agents`);
    // The pre-existing hard-stale rule wins: no entries at all, an explicit
    // source-unavailable error. `unknown` is the CONSUMER's fallback (e.g.
    // supply-catalog's `a.status ?? "unknown"`), never a status we emit from a
    // stale snapshot.
    assert.equal(r.status, 503);
    const doc = await r.json();
    assert.equal(doc.error?.code, "DEPLOYMENT_SOURCE_UNAVAILABLE");
    assert.equal(doc.agents, undefined);
  } finally {
    srv.close();
  }
});

// ── 2.3: strictly additive ────────────────────────────────────────────────
// The pre-change field union, measured against production on 2026-11-13
// (18 entries, 0 carrying `status`): every one of these must still be present.
const PRE_CHANGE_FIELDS = [
  "capabilities", "category", "chatable", "cluster", "description", "facade",
  "facade_stance", "featured", "name", "skills", "slug", "tags", "turns7d", "version",
];

test("2.3 catalog: the new fields are additive — the pre-change union still holds", async () => {
  const dep = mkDep(1);
  const { srv, base } = await harness({
    deployments: [dep],
    entries: { [dep.slug]: mkEntry({ metadata: { facade: { stance: "hosted" } } }) },
    turns: { [dep.slug]: 3 },
    // Subsidy open, as in production on 2026-11-13 (every entry carried
    // `chatable: true`) — otherwise the marker is correctly absent and this
    // union check would be testing a different state.
    subsidyEnabled: true,
    snapshotAt: Date.now(),
  });
  try {
    const doc = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const e = doc.agents[0];
    for (const k of PRE_CHANGE_FIELDS) {
      // `category`/`featured`/`cluster` are conditional by design (no curation
      // and no cluster declaration here) — presence is checked below, not union
      // membership.
      if (["category", "featured", "cluster"].includes(k)) continue;
      assert.ok(k in e, `pre-change field disappeared: ${k}`);
    }
    assert.equal(e.facade, true);
    assert.equal(e.facade_stance, "hosted");
    // and the two new ones
    assert.ok("status" in e);
    assert.ok("status_as_of" in e);
  } finally {
    srv.close();
  }
});

// ── 2.5/2.6: one fact, two faces, the same answer ─────────────────────────
test("2.6 a paused agent is NOT chatable in the catalog, matching the chat status face", async () => {
  const dep = mkDep(1);
  const { srv, base } = await harness({
    deployments: [dep],
    entries: { [dep.slug]: mkEntry({ metadata: { paused: true } }) },
    turns: { [dep.slug]: 5 },
    subsidyEnabled: true, // the allowance waterfall is open — pause alone must suppress it
    snapshotAt: Date.now(),
  });
  try {
    const cat = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const status = await (await fetch(`${base}/api/wanxing/v1/chat/${dep.slug}/status`)).json();

    assert.equal(cat.agents[0].chatable, undefined, "a paused agent must not be advertised as chatable");
    assert.equal(status.chatAble, false);
    assert.equal(status.reason, "agent_paused");
    // the two faces must agree
    assert.equal(Boolean(cat.agents[0].chatable), Boolean(status.chatAble));
  } finally {
    srv.close();
  }
});

test("2.6 an unpaused agent with an open allowance is chatable on both faces", async () => {
  const dep = mkDep(1);
  const { srv, base } = await harness({
    deployments: [dep],
    entries: { [dep.slug]: mkEntry() },
    turns: { [dep.slug]: 1 },
    subsidyEnabled: false,
    hostLimitMinutes: 30,
    snapshotAt: Date.now(),
  });
  try {
    const cat = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const status = await (await fetch(`${base}/api/wanxing/v1/chat/${dep.slug}/status`)).json();
    assert.equal(cat.agents[0].chatable, true);
    assert.equal(status.chatAble, true);
  } finally {
    srv.close();
  }
});

test("2.6 no open allowance on either waterfall level → neither face claims chatable", async () => {
  const dep = mkDep(1);
  const { srv, base } = await harness({
    deployments: [dep],
    entries: { [dep.slug]: mkEntry() },
    turns: { [dep.slug]: 1 },
    subsidyEnabled: false,
    hostLimitMinutes: 0,
    snapshotAt: Date.now(),
  });
  try {
    const cat = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const status = await (await fetch(`${base}/api/wanxing/v1/chat/${dep.slug}/status`)).json();
    assert.equal(cat.agents[0].chatable, undefined);
    assert.equal(status.chatAble, false);
    assert.equal(status.reason, "chat_not_open");
  } finally {
    srv.close();
  }
});

// ── 3.x: curation is a LABEL, never an admission rule ──────────────────────
test("3.3 an uncurated deployment is still listed (curation filters the marketplace, not this catalog)", async () => {
  const curated = mkDep(1);
  const uncurated = mkDep(2);
  const { srv, base } = await harness({
    deployments: [curated, uncurated],
    entries: { [curated.slug]: mkEntry(), [uncurated.slug]: mkEntry() },
    // Only p1 is curated. p2 has a row with neither category nor featured.
    curation: [
      { id: "p1", category: "legal", featured: true },
      { id: "p2", category: "", featured: false },
    ],
    snapshotAt: Date.now(),
  });
  try {
    const doc = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const by = Object.fromEntries(doc.agents.map((a) => [a.slug, a]));
    assert.equal(doc.agents.length, 2, "an uncurated deployment must not be filtered out");
    assert.equal(by[curated.slug].category, "legal");
    assert.equal(by[curated.slug].featured, true);
    assert.equal(by[uncurated.slug].category, undefined);
    assert.equal(by[uncurated.slug].featured, undefined);
  } finally {
    srv.close();
  }
});

test("3.2 the marketplace's operator whitelist does not narrow this catalog", async () => {
  const a = mkDep(1), b = mkDep(2);
  const { srv, base } = await harness({
    deployments: [a, b],
    entries: { [a.slug]: mkEntry(), [b.slug]: mkEntry() },
    curation: [{ id: "p1", category: "legal", featured: true }],
    snapshotAt: Date.now(),
  });
  const prev = process.env.FACET_MARKETPLACE_PACK_IDS;
  process.env.FACET_MARKETPLACE_PACK_IDS = "p1"; // narrow the MARKETPLACE to one pack
  try {
    const doc = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    assert.equal(doc.agents.length, 2, "an operator whitelist must not remove deployed agents here");
  } finally {
    if (prev === undefined) delete process.env.FACET_MARKETPLACE_PACK_IDS;
    else process.env.FACET_MARKETPLACE_PACK_IDS = prev;
    srv.close();
  }
});

test("3.5 the facade never derives curation itself (no name/tag/badge heuristics)", async () => {
  const dep = mkDep(1);
  const { srv, base } = await harness({
    deployments: [dep],
    // A pack whose NAME looks legal-ish and whose tags scream "legal":
    // without a curation row it must still carry no category.
    entries: { [dep.slug]: mkEntry({ name: "legal-assistant", tags: ["legal", "featured"] }) },
    curation: [], // browse succeeded, but knows nothing about this pack
    snapshotAt: Date.now(),
  });
  try {
    const doc = await (await fetch(`${base}/api/wanxing/v1/agents`)).json();
    const e = doc.agents[0];
    assert.equal(e.category, undefined, "category must come from the packs table, never from name/tags");
    assert.equal(e.featured, undefined, "featured must come from the packs table, never from tags");
  } finally {
    srv.close();
  }
});
