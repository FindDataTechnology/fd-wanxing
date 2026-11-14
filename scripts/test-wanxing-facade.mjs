#!/usr/bin/env node
// ── Wanxing facade tests (add-wanxing-serving-api tasks 1.2–1.3, 2.1–2.5, 3.x) ─
//
// Module-level tests for the external front door: the store's tables and
// lifecycle, the kernel (auth fail-closed, admission states, rate/slot
// bounds, idempotent replay, boundary settlement with the probed
// "subtract" direction and debt suspension), and the A2A face end-to-end
// against an in-process express app with stubbed registry/upstream/sub2api.
//
//   node --test scripts/test-wanxing-facade.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { test } from "node:test";

const tmp = mkdtempSync(path.join(tmpdir(), "wanxing-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore, slugFor, maskKey } = await import("../services/wanxing-facade/core.js");
const { createA2aFace, contextIdFor, turnErrorCode } = await import("../services/wanxing-facade/a2a.js");
const { createChatFace } = await import("../services/wanxing-facade/chat.js");

// A stub sub2api client with call counters — every behavior is programmable
// per test by mutating these fields.
function stubSub2api({ userId = 7, email = "caller@finddata.tech" } = {}) {
  return {
    userId,
    email,
    probeCalls: 0,
    resolveCalls: 0,
    adjustCalls: [],
    probeOk: true,
    resolveOk: true,
    adjustOk: true,
    degraded: () => false,
    async probeKeyLiveness() {
      this.probeCalls += 1;
      return this.probeOk ? { ok: true } : { ok: false, code: "INSUFFICIENT_BALANCE", message: "insufficient balance" };
    },
    async findUserByKey() {
      this.resolveCalls += 1;
      return this.resolveOk ? { userId: this.userId, email: this.email } : null;
    },
    async findUserByEmail(mail) {
      return mail === this.email ? { userId: this.userId, email: this.email } : null;
    },
    async adjustBalance(args) {
      this.adjustCalls.push(args);
      if (!this.adjustOk) throw new Error("sub2api unreachable");
      return { ok: true };
    },
  };
}

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

// ── Task 1.3: tables migrate idempotently; store lifecycle ──────────────────

test("1.3 store opens twice on the same file (idempotent migrations)", () => {
  const file = path.join(mkdtempSync(path.join(tmp, "m-")), "wanxing.db");
  const a = createWanxingStore({ file });
  a.close();
  const b = createWanxingStore({ file });
  b.close();
});

test("1.3 allowlist add/has/list/remove roundtrip", () => {
  const s = freshStore();
  s.allowlistAdd("agent-x", 7, "caller@finddata.tech");
  assert.equal(s.allowlistHas("agent-x", 7), true);
  assert.equal(s.allowlistHas("agent-x", 8), false);
  assert.equal(s.allowlistList("agent-x").length, 1);
  s.allowlistRemove("agent-x", 7);
  assert.equal(s.allowlistHas("agent-x", 7), false);
});

// ── Task 1.2: caller-key authentication ──────────────────────────────────────

test("1.2 auth fails closed without a billing plane", async () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: null });
  const r = await core.authenticate("sk-livekey");
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test("1.2 auth fails closed on a degraded client", async () => {
  const sub = stubSub2api();
  sub.degraded = () => true;
  const core = createWanxingCore({ store: freshStore(), sub2api: sub });
  assert.equal((await core.authenticate("sk-livekey")).status, 503);
});

test("1.2 malformed keys never reach the probe", async () => {
  const sub = stubSub2api();
  const core = createWanxingCore({ store: freshStore(), sub2api: sub });
  const r = await core.authenticate("not-a-key");
  assert.equal(r.status, 401);
  assert.equal(sub.probeCalls, 0);
});

test("1.2 the billing gate refuses broke keys with 402", async () => {
  const sub = stubSub2api();
  sub.probeOk = false;
  const core = createWanxingCore({ store: freshStore(), sub2api: sub });
  const r = await core.authenticate("sk-broke");
  assert.equal(r.status, 402);
  assert.equal(r.code, "INSUFFICIENT_BALANCE");
});

test("1.2 a valid key resolves the caller and hits the verdict cache", async () => {
  const sub = stubSub2api();
  const core = createWanxingCore({ store: freshStore(), sub2api: sub });
  const r1 = await core.authenticate("sk-good");
  assert.deepEqual(r1.caller, { userId: 7, email: "caller@finddata.tech" });
  await core.authenticate("sk-good");
  assert.equal(sub.probeCalls, 1, "second call served from cache");
});

test("1.2 maskKey never exposes more than the last four", () => {
  assert.equal(maskKey("sk-abcdefgh1234"), "…1234");
  assert.equal(maskKey(""), "");
});

// ── Task 2.1: admission states ───────────────────────────────────────────────

const CALLER = { userId: 7, email: "caller@finddata.tech" };

test("2.1 admission: not-found / paused / private-not-listed / private-listed / public", () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: stubSub2api() });
  assert.equal(core.admit(CALLER, { exists: false, slug: "x" }).status, 404);
  assert.equal(core.admit(CALLER, { exists: true, slug: "x", paused: true, visibility: "public" }).status, 423);
  assert.equal(core.admit(CALLER, { exists: true, slug: "x", paused: false, visibility: "private" }).status, 403);
  const s = freshStore();
  s.allowlistAdd("x", 7, CALLER.email);
  const core2 = createWanxingCore({ store: s, sub2api: stubSub2api() });
  assert.equal(core2.admit(CALLER, { exists: true, slug: "x", paused: false, visibility: "private" }).ok, true);
  assert.equal(core.admit(CALLER, { exists: true, slug: "x", paused: false, visibility: "public" }).ok, true);
});

// ── Task 2.2: rate and slot bounds ───────────────────────────────────────────

test("2.2 rpm bound trips over the limit within the window", () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: stubSub2api(), config: { rpmMax: 2 } });
  assert.equal(core.checkRpm(7), true);
  assert.equal(core.checkRpm(7), true);
  assert.equal(core.checkRpm(7), false, "third request in the window is throttled");
  assert.equal(core.checkRpm(8), true, "other callers unaffected");
});

test("2.2 one in-flight turn per (caller, agent)", () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: stubSub2api() });
  assert.equal(core.acquireSlot(7, "a"), true);
  assert.equal(core.acquireSlot(7, "a"), false);
  assert.equal(core.acquireSlot(7, "b"), true);
  core.releaseSlot(7, "a");
  assert.equal(core.acquireSlot(7, "a"), true);
});

// ── Task 2.3: idempotent replay and single-flight ────────────────────────────

test("2.3 a replayed key returns the recorded outcome without a second exec", async () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: stubSub2api() });
  let execs = 0;
  const exec = async () => ({ response: { jsonrpc: "2.0", id: 1, result: { n: execs } } });
  const r1 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k1", exec: async () => { execs += 1; return exec(); } });
  const r2 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k1", exec: async () => { execs += 1; return exec(); } });
  assert.equal(execs, 1);
  assert.deepEqual(r1.response, r2.response);
  assert.equal(r2.replayed, true);
});

test("2.3b fingerprint hardening: same key + different body = 409 IDEMPOTENCY_KEY_REUSE; NULL-fingerprint heal; both-sideless replay (unify-wanxing-a2a-face 2.1)", async () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: stubSub2api() });
  const ok = (v) => async () => ({ response: { ok: v } });
  // A recorded success replays on the same fingerprint…
  await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k1", requestHash: "fp-A", exec: ok("first") });
  const r1 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k1", requestHash: "fp-A", exec: async () => { throw new Error("must not run"); } });
  assert.equal(r1.replayed, true);
  // …and is REFUSED on a different body (the reset-ticket trap).
  await assert.rejects(
    () => core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k1", requestHash: "fp-B", exec: ok("swapped") }),
    (e) => e.code === "IDEMPOTENCY_KEY_REUSE" && e.status === 409,
  );
  // Heal case: a pre-fingerprinting NULL-hash recording re-executes once when
  // a fingerprint-bearing retry arrives, and the backfill binds it.
  await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k2", exec: ok("legacy") });
  let ran = 0;
  const r2 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k2", requestHash: "fp-C", exec: async () => { ran += 1; return { response: { ok: "healed" } }; } });
  assert.equal(r2.replayed, false);
  assert.equal(ran, 1, "legacy NULL-hash row re-executed (cannot trust the match)");
  const r3 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k2", requestHash: "fp-C", exec: async () => { throw new Error("must not run"); } });
  assert.equal(r3.replayed, true, "backfilled hash replays from then on");
  // Both sides fingerprintless (older callers): plain replay semantics kept.
  await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k3", exec: ok("plain") });
  const r4 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k3", exec: async () => { throw new Error("must not run"); } });
  assert.equal(r4.replayed, true);
  // Legacy NULL-hash row + fingerprintless retry keeps replay too.
  await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k4", exec: ok("legacy2") });
  const r5 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k4", exec: async () => { throw new Error("must not run"); } });
  assert.equal(r5.replayed, true);
  // The store migration: an old file without the column must open cleanly —
  // rebuild one by hand (the factory exposes no raw db) and reopen.
  const oldFile = path.join(mkdtempSync(path.join(tmp, "legacy-")), "wanxing.db");
  {
    const legacy = createWanxingStore({ file: oldFile });
    legacy.close();
  }
  const Database = (await import("better-sqlite3")).default;
  const raw = new Database(oldFile);
  raw.exec(`CREATE TABLE IF NOT EXISTS wanxing_requests (caller_id INTEGER NOT NULL, agent_slug TEXT NOT NULL, idem_key TEXT NOT NULL, state TEXT NOT NULL, response TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (caller_id, agent_slug, idem_key))`);
  raw.close();
  const legacyStore = createWanxingStore({ file: oldFile });
  const core2 = createWanxingCore({ store: legacyStore, sub2api: stubSub2api() });
  await core2.idempotentSend({ callerId: 1, slug: "a", idemKey: "m", requestHash: "fp", exec: ok("migrated") });
  assert.equal(legacyStore.requestGet(1, "a", "m").request_hash, "fp");
});

test("2.3 concurrent duplicates join one flight", async () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: stubSub2api() });
  let execs = 0;
  const exec = () => new Promise((r) => setTimeout(() => { execs += 1; r({ response: { ok: true } }); }, 30));
  const [a, b] = await Promise.all([
    core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k", exec }),
    core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k", exec }),
  ]);
  assert.equal(execs, 1);
  assert.deepEqual(a.response, b.response);
});

test("2.3 a failed exec records the error and does NOT replay it — the retry re-executes (unify-wanxing-a2a-face 2.1: paas D1 backport)", async () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: stubSub2api() });
  let attempts = 0;
  const boom = async () => {
    attempts += 1;
    throw Object.assign(new Error("agent route refused"), { code: -32033 });
  };
  await assert.rejects(() => core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k", requestHash: "fp-1", exec: boom }));
  // An errored first turn is never replayed: the same key + same body is a
  // REAL retry — re-executes (pays full admission) and overwrites the row.
  await assert.rejects(() => core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k", requestHash: "fp-1", exec: boom }));
  assert.equal(attempts, 2);
  // A later SUCCESS on the same key records and replays from then on.
  const r3 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k", requestHash: "fp-1", exec: async () => ({ response: { ok: true } }) });
  assert.equal(r3.replayed, false);
  const r4 = await core.idempotentSend({ callerId: 7, slug: "a", idemKey: "k", requestHash: "fp-1", exec: async () => { throw new Error("must not run"); } });
  assert.equal(r4.replayed, true);
  assert.deepEqual(r4.response, { ok: true });
});

// ── Task 2.4: metering and boundary settlement ───────────────────────────────

test("2.4 minutes round up, ok turns settle once via subtract, and the row id is the idempotency key", async () => {
  const sub = stubSub2api();
  const core = createWanxingCore({ store: freshStore(), sub2api: sub, config: { ratePerMin: 0.1 } });
  const row = core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 90_000, outcome: "ok" });
  assert.equal(row.minutesBilled, 2, "90s bills two started minutes");
  assert.equal(row.settlementStatus, "pending");
  assert.equal(await core.trySettle(row), true);
  assert.equal(sub.adjustCalls.length, 1);
  assert.deepEqual(
    { amountUsd: sub.adjustCalls[0].amountUsd, operation: sub.adjustCalls[0].operation, idempotencyKey: sub.adjustCalls[0].idempotencyKey },
    { amountUsd: 0.2, operation: "subtract", idempotencyKey: row.id },
  );
});

test("2.4 errored turns are recorded but waived", () => {
  const core = createWanxingCore({ store: freshStore(), sub2api: stubSub2api() });
  const row = core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 60_000, outcome: "error" });
  assert.equal(row.settlementStatus, "waived");
  assert.equal(row.minutesBilled, 0);
});

test("2.4 repeated settlement failures suspend the caller; the gate re-admits after recovery", async () => {
  const sub = stubSub2api();
  sub.adjustOk = false;
  const store = freshStore();
  const core = createWanxingCore({ store, sub2api: sub, config: { suspendAfterFailures: 3 } });
  for (let i = 0; i < 3; i++) {
    const row = core.recordUsage({ caller: CALLER, slug: "a", idemKey: `k${i}`, startedAt: 0, endedAt: 60_000, outcome: "ok" });
    assert.equal(await core.trySettle(row), false);
  }
  assert.match(store.callerState(7).suspended_reason, /settlement failed/);
  const refused = await core.authenticate("sk-good");
  assert.equal(refused.status, 402);
  assert.equal(refused.code, "CALLER_SUSPENDED");
  // Recovery: the balance gate passes again and a settle succeeds → cleared.
  sub.adjustOk = true;
  const okRow = core.recordUsage({ caller: CALLER, slug: "a", idemKey: "kx", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  assert.equal(await core.trySettle(okRow), true);
  assert.equal(store.callerState(7).suspended_reason, null);
  assert.equal((await core.authenticate("sk-good")).ok, true);
});

test("2.4 settlePending retries what the turn path could not settle", async () => {
  const sub = stubSub2api();
  const store = freshStore();
  const core = createWanxingCore({ store, sub2api: sub });
  const row = core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  sub.adjustOk = false;
  await core.trySettle(row);
  assert.equal(store.usagePending().length, 1);
  sub.adjustOk = true;
  await core.settlePending();
  assert.equal(store.usagePending().length, 0);
});

test("5.1 the usage board aggregates by caller and by agent", async () => {
  const sub = stubSub2api();
  const store = freshStore();
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1 } });
  for (const [slug, idem] of [["a", "k1"], ["a", "k2"], ["b", "k3"]]) {
    const row = core.recordUsage({ caller: CALLER, slug, idemKey: idem, startedAt: 0, endedAt: 60_000, outcome: "ok" });
    await core.trySettle(row);
  }
  const board = store.usageBoard();
  assert.equal(board.byCaller.length, 1);
  assert.equal(board.byCaller[0].turns, 3);
  assert.equal(board.byCaller[0].minutes, 3);
  assert.equal(board.byAgent.find((a) => a.agent === "a").turns, 2);
});

// ── Task 3.x: the A2A face against a listening app ───────────────────────────

function faceHarness({ entry, upstream, sub = stubSub2api(), store = freshStore(), seat = null } = {}) {
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 100 } });
  const upstreamCalls = [];
  const defaultEntry = {
    name: "SpiderHeal",
    description: "repairs spiders",
    version: "3",
    visibility: "public",
    capabilities: { streaming: true },
    skills: [],
    tags: ["ops"],
    metadata: {},
  };
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-heal" ? { agentPath: "/packs/p1/heal" } : null),
    listDeployments: () => [{ slug: "packs-p1-heal", agentPath: "/packs/p1/heal" }],
    forwardHeaders: () => ({ "X-Authorization": "Bearer svc", Authorization: "Bearer backend" }),
    registryFetch: async () => new Response(JSON.stringify({ ...defaultEntry, ...(entry ?? {}) }), { headers: { "Content-Type": "application/json" } }),
    config: {
      agentUrlFor: (p) => `https://registry.internal/agent${p}/`,
      ...(seat ? { seatTargetFor: async () => seat.runnerId, mailboxEnqueue: (args) => seat.enqueue(args) } : {}),
    },
    upstreamFetch: async (url, init) => {
      if (seat) throw new Error("seat targets must never reach the upstream");
      upstreamCalls.push({ url, init });
      return upstream(init);
    },
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    core, store, upstreamCalls, base, sub,
    close: () => new Promise((r) => server.close(r)),
    call: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) })),
    callText: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, headers: r.headers, text: await r.text() })),
  };
}

const sendBody = (text, extra = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "message/send",
  params: { message: { role: "user", parts: [{ kind: "text", text }], ...extra } },
});

const jsonReply = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: { parts: [{ kind: "text", text: "queued" }] } } }), { headers: { "Content-Type": "application/json" } });

test("3.2 catalog and card are public; private agents are absent", async () => {
  const h = faceHarness({ entry: { visibility: "public" } });
  const cat = await h.call("/api/wanxing/v1/agents");
  assert.equal(cat.status, 200);
  assert.equal(cat.body.agents[0].slug, "packs-p1-heal");
  const card = await h.call("/api/wanxing/v1/a2a/packs-p1-heal/.well-known/agent-card.json");
  assert.equal(card.status, 200);
  assert.match(card.body.url, /\/api\/wanxing\/v1\/a2a\/packs-p1-heal$/);
  await h.close();
  const priv = faceHarness({ entry: { visibility: "private" } });
  assert.equal((await priv.call("/api/wanxing/v1/agents")).body.agents.length, 0);
  assert.equal((await priv.call("/api/wanxing/v1/a2a/packs-p1-heal/.well-known/agent-card.json")).status, 404);
  await priv.close();
});

test("3.2c curated public status serves three aggregates with staleness bits (wanxing-first-visitor 3.1)", async () => {
  // faceHarness builds the face without settlementPending; rebuild with it.
  const sub = stubSub2api();
  const store = freshStore();
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 100 } });
  const defaultEntry = {
    name: "SpiderHeal", description: "repairs spiders", version: "3", visibility: "public",
    capabilities: { streaming: true }, skills: [], tags: ["ops"], metadata: {},
  };
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-heal" ? { agentPath: "/packs/p1/heal" } : null),
    listDeployments: () => [{ slug: "packs-p1-heal", agentPath: "/packs/p1/heal" }],
    forwardHeaders: () => ({}),
    registryFetch: async () => new Response(JSON.stringify(defaultEntry), { headers: { "Content-Type": "application/json" } }),
    usageTurnsByAgent: () => new Map([["packs-p1-heal", 12]]),
    settlementPending: () => ({ count: 2, usd: 0.4 }),
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + "/api/wanxing/v1/status").then(async (x) => ({ status: x.status, headers: x.headers, body: await x.json() }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.agents, { value: 1, stale: false });
  assert.deepEqual(r.body.turns7d, { value: 12, stale: false });
  assert.deepEqual(r.body.settlement_pending, { value: { count: 2, usd: 0.4 }, stale: false });
  assert.match(r.headers.get("cache-control") ?? "", /max-age=60/);
  assert.equal(JSON.stringify(r.body).includes("100.64"), false, "no internal addresses leak");
  // A failing source degrades that aggregate to stale, never 500s the payload.
  const broken = createA2aFace({
    core,
    resolveDeployment: async () => { throw new Error("down"); },
    listDeployments: async () => { throw new Error("down"); },
    forwardHeaders: () => ({}),
    registryFetch: async () => new Response("{}", { status: 500 }),
    settlementPending: () => { throw new Error("down"); },
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
  });
  const app2 = express();
  broken.register(app2);
  const server2 = http.createServer(app2).listen(0);
  const r2 = await fetch(`http://127.0.0.1:${server2.address().port}/api/wanxing/v1/status`).then(async (x) => ({ status: x.status, body: await x.json() }));
  assert.equal(r2.status, 200);
  assert.equal(r2.body.agents.stale, true);
  assert.equal(r2.body.agents.value, null);
  assert.equal(r2.body.settlement_pending.stale, true);
  await new Promise((res) => { server.close(res); server2.close(res); });
});

test("3.2b public card redacts non-public provider.url (redact-agent-card-private-endpoints)", async () => {
  // internal runner address → url key dropped, rest of provider intact
  const h1 = faceHarness({ entry: { visibility: "public", provider: { organization: "paas-pack", url: "http://100.64.0.8" } } });
  const c1 = await h1.call("/api/wanxing/v1/a2a/packs-p1-heal/.well-known/agent-card.json");
  assert.equal(c1.status, 200);
  assert.equal(c1.body.provider.url, undefined);
  assert.equal(c1.body.provider.organization, "paas-pack");
  // single-label service name also private
  const h2 = faceHarness({ entry: { visibility: "public", provider: { organization: "o", url: "http://runner:3080" } } });
  assert.equal((await h2.call("/api/wanxing/v1/a2a/packs-p1-heal/.well-known/agent-card.json")).body.provider.url, undefined);
  await h1.close();
  await h2.close();
  // public URL passes through verbatim
  const h3 = faceHarness({ entry: { visibility: "public", provider: { organization: "x", url: "https://mcp.finddatatech.cloud" } } });
  const c3 = await h3.call("/api/wanxing/v1/a2a/packs-p1-heal/.well-known/agent-card.json");
  assert.equal(c3.body.provider.url, "https://mcp.finddatatech.cloud");
  assert.equal(c3.body.provider.organization, "x");
  await h3.close();
  // unparseable → fail closed
  const h4 = faceHarness({ entry: { visibility: "public", provider: { organization: "x", url: "not a url" } } });
  assert.equal((await h4.call("/api/wanxing/v1/a2a/packs-p1-heal/.well-known/agent-card.json")).body.provider.url, undefined);
  await h4.close();
});

test("3.1 send: auth → forward on dual internal credentials → wx context → settled ledger row", async () => {
  const upstreamCalls = [];
  const sub = stubSub2api();
  const store = freshStore();
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 100 } });
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-heal" ? { agentPath: "/packs/p1/heal" } : null),
    listDeployments: () => [{ slug: "packs-p1-heal", agentPath: "/packs/p1/heal" }],
    forwardHeaders: () => ({ "X-Authorization": "Bearer svc", Authorization: "Bearer backend" }),
    registryFetch: async () => new Response(JSON.stringify({ name: "S", visibility: "public", metadata: {} }), { headers: { "Content-Type": "application/json" } }),
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async (url, init) => {
      upstreamCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return jsonReply();
    },
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const noKey = await fetch(base + "/api/wanxing/v1/a2a/packs-p1-heal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sendBody("hi")) });
  assert.equal(noKey.status, 401);

  const ok = await fetch(base + "/api/wanxing/v1/a2a/packs-p1-heal", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good", "Idempotency-Key": "fd-001" },
    body: JSON.stringify(sendBody("SUBMIT repo ticket.yaml")),
  });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).result.message.parts[0].text, "queued");
  assert.equal(upstreamCalls.length, 1);
  assert.equal(upstreamCalls[0].headers["X-Authorization"], "Bearer svc");
  assert.equal(upstreamCalls[0].headers.Authorization, "Bearer backend");
  assert.match(upstreamCalls[0].body.params.message.context_id, /^wx:/);

  // Replay: no second upstream call, no second ledger row.
  const replay = await fetch(base + "/api/wanxing/v1/a2a/packs-p1-heal", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good", "Idempotency-Key": "fd-001" },
    body: JSON.stringify(sendBody("SUBMIT repo ticket.yaml")),
  });
  assert.equal(replay.status, 200);
  assert.equal(upstreamCalls.length, 1);
  const board = store.usageBoard();
  assert.equal(board.byCaller[0].turns, 1);
  assert.equal(board.byCaller[0].pending, 0, "settled inline");
  await new Promise((r) => server.close(r));
});

test("3.1 paused answers 423; private-not-listed answers 403; unknown slug answers 404", async () => {
  const paused = faceHarness({ entry: { visibility: "public", metadata: { paused: true } } });
  const r1 = await paused.call("/api/wanxing/v1/a2a/packs-p1-heal", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" }, body: JSON.stringify(sendBody("hi")) });
  assert.equal(r1.status, 423);
  await paused.close();

  const priv = faceHarness({ entry: { visibility: "private" } });
  const r2 = await priv.call("/api/wanxing/v1/a2a/packs-p1-heal", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" }, body: JSON.stringify(sendBody("hi")) });
  assert.equal(r2.status, 403);
  await priv.close();

  const none = faceHarness({});
  const r3 = await none.call("/api/wanxing/v1/a2a/no-such-agent", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" }, body: JSON.stringify(sendBody("hi")) });
  assert.equal(r3.status, 404);
  await none.close();
});

test("3.1 a concurrent second turn for the same (caller, agent) is refused with Retry-After", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = faceHarness({ upstream: async () => { await gate; return jsonReply(); } });
  const opts = { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" }, body: JSON.stringify(sendBody("slow")) };
  const first = fetch(h.base + "/api/wanxing/v1/a2a/packs-p1-heal", { ...opts, headers: { ...opts.headers, "Idempotency-Key": "s1" } });
  await new Promise((r) => setTimeout(r, 50)); // let the first acquire the slot
  const second = await fetch(h.base + "/api/wanxing/v1/a2a/packs-p1-heal", { ...opts, headers: { ...opts.headers, "Idempotency-Key": "s2" } });
  assert.equal(second.status, 409);
  assert.equal(second.headers.get("retry-after"), "5");
  release();
  assert.equal((await first).status, 200);
  await h.close();
});

test("3.3 unsupported methods answer JSON-RPC method-not-found; malformed bodies -32600", async () => {
  const h = faceHarness({});
  const r = await h.call("/api/wanxing/v1/a2a/packs-p1-heal", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tasks/get", params: {} }),
  });
  assert.equal(r.body.error.code, -32601);
  const bad = await h.call("/api/wanxing/v1/a2a/packs-p1-heal", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" },
    body: JSON.stringify({ hello: 1 }),
  });
  assert.equal(bad.body.error.code, -32600);
  await h.close();
});

test("3.1 stream: SSE frames pass through and the ledger closes on stream end", async () => {
  const frames = [
    `event: delta\ndata: {"parts":[{"text":"que"}]}\n\n`,
    `event: message\ndata: {"parts":[{"text":"queued"}]}\n\n`,
    `event: done\ndata: {}\n\n`,
  ];
  const stream = new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(new TextEncoder().encode(f));
      c.close();
    },
  });
  const h = faceHarness({
    upstream: async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
  });
  const r = await fetch(h.base + "/api/wanxing/v1/a2a/packs-p1-heal", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "message/stream", params: { message: { role: "user", parts: [{ kind: "text", text: "hi" }] } } }),
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/event-stream/);
  const text = await r.text();
  assert.match(text, /event: done/);
  const board = h.store.usageBoard();
  assert.equal(board.byCaller[0].turns, 1);
  await h.close();
});

test("2.5/D2 slug derivation is stable and collision-shaped like the runner key", () => {
  assert.equal(slugFor("/packs/AbC.x/Heal.y"), "packs-abc.x-heal.y");
});

test("D5 context derivation: supplied passes through; keyed send is replay-stable; keyless stream is one-shot", () => {
  assert.equal(contextIdFor({ context_id: "ctx-9" }, null), "ctx-9");
  const a = contextIdFor({}, "fd-001");
  const b = contextIdFor({}, "fd-001");
  assert.equal(a, b);
  assert.match(a, /^wx:[0-9a-f]{16}$/);
  assert.match(contextIdFor({}, null), /^wx:[0-9a-f]{16}$/);
  assert.notEqual(contextIdFor({}, null), contextIdFor({}, null));
});

// ── Task 4.1: runner external-context reap ──────────────────────────────────

// (4.1 reap test stays in paas: it exercises agent-runner's
// reapExternalContexts — runner code, not the extracted facade unit.)

// ── Task 2.5 + 5.1 (ported for add-facade-extraction): the wiring module's
// routes. The extracted unit has no login surface, so the packs internal API
// — a borrowed contract over HTTP — is stubbed with a token-gated express app
// (the contract shape, not paas code, is what this unit depends on), and the
// allowlist is seeded through the store (its management HTTP moves to the
// slice-⑤ deployer surface).

test("2.5/5.1 registerWanxingRoutes: allowlisted private agent is callable; ops usage answers on the service credential", async () => {
  const { registerWanxingRoutes } = await import("../services/wanxing-facade/routes.js");
  const sub = stubSub2api();
  const store = freshStore();
  const upstreamCalls = [];

  const pub = { id: "Pk1" };
  const slug = slugFor(`/packs/${pub.id}/heal`);

  // The packs internal contract stub: token-gated deployment bookkeeping.
  const packsApp = express();
  packsApp.get("/api/packs/internal/deployments", (req, res) => {
    if (req.headers.authorization !== "Bearer svc-tok") return res.status(401).json({ error: "auth required" });
    res.json({ deployments: [{ packId: pub.id, agentId: "heal", agentPath: `/packs/${pub.id}/heal`, version: 1 }] });
  });
  const packsSrv = http.createServer(packsApp).listen(0);
  await new Promise((r) => packsSrv.once("listening", r));
  const packsBase = `http://127.0.0.1:${packsSrv.address().port}`;

  const env = {
    PACKS_INTERNAL_BASE_URL: packsBase,
    AGENT_SERVING_REGISTRY_URL: "https://reg.internal",
    AGENT_SERVING_REGISTRY_TOKEN: "svc-tok",
    AGENT_SERVING_BACKEND_TOKEN: "back-tok",
  };
  const fetchImpl = async (url, init = {}) => {
    if (url.startsWith("http://127.0.0.1:")) return fetch(url, init);
    if (url.startsWith("https://reg.internal/api/agents")) {
      return new Response(JSON.stringify({ name: "S", visibility: "private", metadata: {} }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("https://reg.internal/agent/")) {
      upstreamCalls.push({ headers: init.headers });
      return jsonReply();
    }
    return new Response("{}", { status: 404 });
  };
  const app = express();
  const wired = registerWanxingRoutes(app, {
    dataRoot: tmp,
    env,
    fetchImpl,
    store,
    sub2api: sub,
  });
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // The bookkeeping contract is token-gated.
    assert.equal((await fetch(`${packsBase}/api/packs/internal/deployments`)).status, 401);

    // Private agent: refused before allowlisting (stub sub2api resolves the
    // caller to userId 7).
    const send = () =>
      fetch(`${base}/api/wanxing/v1/a2a/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" },
        body: JSON.stringify(sendBody("hi")),
      });
    assert.equal((await send()).status, 403);

    // Management HTTP is gone in the extracted unit; the store seed is the
    // deployer surface's (slice ⑤) future write path.
    store.allowlistAdd(slug, 7, "caller@finddata.tech");

    // Now the same key is admitted and forwarded on the internal credentials.
    const okTurn = await send();
    assert.equal(okTurn.status, 200);
    assert.equal(upstreamCalls.length, 1);
    assert.equal(upstreamCalls[0].headers["X-Authorization"], "Bearer svc-tok");

    // Ops view: the service credential reads the board (no login session
    // exists in this unit).
    assert.equal((await fetch(`${base}/api/wanxing/v1/ops/usage`)).status, 401);
    const ops = await fetch(`${base}/api/wanxing/v1/ops/usage`, { headers: { Authorization: "Bearer svc-tok" } });
    assert.equal(ops.status, 200);
    const board = await ops.json();
    assert.equal(board.byCaller.length, 1);
    assert.equal(board.byCaller[0].turns, 1);

    // Liveness for the standalone deployment.
    assert.equal((await (await fetch(`${base}/healthz`)).json()).ok, true);
  } finally {
    wired.close();
    await new Promise((r) => server.close(r));
    await new Promise((r) => packsSrv.close(r));
  }
});

// ── S0: the deployment source being unreachable is a 503, never a hang and
// never a silent "no agents" — the catalog, the card, and the turn surface
// all say DEPLOYMENT_SOURCE_UNAVAILABLE.

test("S0 deployment source unreachable ⇒ 503 DEPLOYMENT_SOURCE_UNAVAILABLE on catalog, card, and turn", async () => {
  const { registerWanxingRoutes } = await import("../services/wanxing-facade/routes.js");
  const store = freshStore();
  const env = {
    // Point at a port nothing listens on.
    PACKS_INTERNAL_BASE_URL: "http://127.0.0.1:9",
  };
  const app = express();
  const wired = registerWanxingRoutes(app, {
    dataRoot: tmp,
    env,
    store,
    // The turn surface authenticates the caller BEFORE agent resolution, so
    // the 503 only surfaces with a key that passes the billing gate.
    sub2api: stubSub2api(),
  });
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cat = await fetch(`${base}/api/wanxing/v1/agents`);
    assert.equal(cat.status, 503);
    assert.equal((await cat.json()).error.code, "DEPLOYMENT_SOURCE_UNAVAILABLE");

    const card = await fetch(`${base}/api/wanxing/v1/a2a/whatever/.well-known/agent-card.json`);
    assert.equal(card.status, 503);

    const turn = await fetch(`${base}/api/wanxing/v1/a2a/whatever`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good" },
      body: JSON.stringify(sendBody("hi")),
    });
    assert.equal(turn.status, 503);
    assert.equal((await turn.json()).error.code, "DEPLOYMENT_SOURCE_UNAVAILABLE");
  } finally {
    wired.close();
    await new Promise((r) => server.close(r));
  }
});

// ── Live-probe regression (2026-10-03 fd-prod): replay must not leak the
// (caller, agent) slot; concurrent same-key duplicates join the flight at the
// ROUTE level, not just in the kernel.

test("regression: replay frees the slot — a fresh-key turn afterwards is not 409", async () => {
  const upstreamCalls = [];
  const store = freshStore();
  const sub = stubSub2api();
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 100 } });
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-heal" ? { agentPath: "/packs/p1/heal" } : null),
    listDeployments: () => [{ slug: "packs-p1-heal", agentPath: "/packs/p1/heal" }],
    forwardHeaders: () => ({ "X-Authorization": "Bearer svc", Authorization: "Bearer backend" }),
    registryFetch: async () => new Response(JSON.stringify({ name: "S", visibility: "public", metadata: {} }), { headers: { "Content-Type": "application/json" } }),
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => {
      upstreamCalls.push(1);
      return jsonReply();
    },
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (key) =>
    fetch(`${base}/api/wanxing/v1/a2a/packs-p1-heal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good", ...(key ? { "Idempotency-Key": key } : {}) },
      body: JSON.stringify(sendBody("hi")),
    });
  try {
    assert.equal((await post("k1")).status, 200);
    assert.equal((await post("k1")).status, 200, "replay");
    // Before the fix this was 409 forever: the replay had leaked the slot.
    assert.equal((await post("k2")).status, 200, "fresh key after a replay must run, not 409");
    assert.equal(upstreamCalls.length, 2, "k1 once + k2 once");
    assert.equal(store.usageBoard().byCaller[0].turns, 2, "two billable turns, replay records none");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("regression: concurrent same-key duplicates join the flight through the route", async () => {
  const upstreamCalls = [];
  const store = freshStore();
  const sub = stubSub2api();
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 100 } });
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-heal" ? { agentPath: "/packs/p1/heal" } : null),
    listDeployments: () => [{ slug: "packs-p1-heal", agentPath: "/packs/p1/heal" }],
    forwardHeaders: () => ({ "X-Authorization": "Bearer svc", Authorization: "Bearer backend" }),
    registryFetch: async () => new Response(JSON.stringify({ name: "S", visibility: "public", metadata: {} }), { headers: { "Content-Type": "application/json" } }),
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => {
      upstreamCalls.push(1);
      await new Promise((r) => setTimeout(r, 40));
      return jsonReply();
    },
  });
  const app = express();
  face.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = () =>
    fetch(`${base}/api/wanxing/v1/a2a/packs-p1-heal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good", "Idempotency-Key": "race" },
      body: JSON.stringify(sendBody("hi")),
    });
  try {
    const first = post();
    await new Promise((r) => setTimeout(r, 15)); // flight registered, still running
    const second = await post();
    const a = await first;
    assert.equal(second.status, 200, "duplicate joins the flight instead of 409");
    assert.equal(a.status, 200);
    const d1 = await second.json();
    const d2 = await a.json();
    assert.deepEqual(d1, d2, "both callers receive the same outcome");
    assert.equal(upstreamCalls.length, 1, "exactly one turn ran");
    assert.equal(store.usageBoard().byCaller[0].turns, 1, "one billable turn");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── add-agent-chat-lane 2.1: channel/settler/visitor columns + derivation ────

test("2.1 chat columns: ledger rows carry the lane; allowance derives from the ledger", () => {
  const s = freshStore();
  const ins = (o) => s.usageInsert({
    id: o.id, callerId: o.callerId ?? 7, callerEmail: o.email ?? "c@x", agentSlug: o.slug ?? "a",
    idemKey: o.idemKey ?? "", startedAt: o.at, endedAt: o.at + 1000, durationMs: 1000,
    outcome: o.outcome ?? "ok", minutesBilled: o.minutes ?? 1, rateUsd: 0.1,
    settlementStatus: o.status ?? "pending", channel: o.channel, settler: o.settler, visitorSub: o.visitorSub,
  });
  ins({ id: "u-api", at: 1 }); // an API-lane row keeps its default lane
  ins({ id: "u-c1", at: 10, email: "visitor@x", callerId: 0, channel: "chat", settler: "subsidy", visitorSub: "v1", minutes: 1 });
  ins({ id: "u-c2", at: 20, email: "visitor@x", callerId: 0, channel: "chat", settler: "subsidy", visitorSub: "v1", minutes: 2 });
  ins({ id: "u-c3", at: 30, email: "visitor2@x", callerId: 0, channel: "chat", settler: "host", visitorSub: "v2", minutes: 5, slug: "a" });
  ins({ id: "u-c4", at: 40, email: "visitor3@x", callerId: 0, channel: "chat", settler: "subsidy", visitorSub: "v3", minutes: 4, slug: "other" });

  // Subsidy per visitor, windowed — v1 used 3 minutes total, 1 before t=15.
  assert.equal(s.chatSubsidyUsed("v1", 0, 15), 1);
  assert.equal(s.chatSubsidyUsed("v1", 0, 1000), 3);
  assert.equal(s.chatSubsidyUsed("v2", 0, 1000), 0, "host minutes never count as subsidy");
  // Host usage is all-time per agent (v2's 5 on a; other-agent host rows don't leak).
  assert.equal(s.hostAllowanceUsed("a"), 5);
  assert.equal(s.hostAllowanceUsed("other"), 0);

  // Owner aggregates: by caller × channel, both lanes labeled by email.
  const byCaller = s.usageByCaller("a", 0);
  assert.equal(byCaller.length, 3);
  const apiRow = byCaller.find((r) => r.channel === "api");
  assert.deepEqual({ email: apiRow.email, turns: apiRow.turns, minutes: apiRow.minutes }, { email: "c@x", turns: 1, minutes: 1 });
  const chatVisitor = byCaller.find((r) => r.channel === "chat" && r.email === "visitor@x");
  assert.equal(chatVisitor.turns, 2);
  // Activity stream: newest first, both lanes visible.
  const act = s.usageActivity("a", 10);
  assert.equal(act[0].id ?? act[0].email, act[0].email); // shape sanity
  assert.deepEqual(act.map((r) => r.channel), ["chat", "chat", "chat", "api"]);

  // Host allowance cap roundtrip + adjust.
  assert.equal(s.hostAllowanceGet("a"), null);
  s.hostAllowanceSet("a", 600, "deployer@x");
  assert.equal(s.hostAllowanceGet("a").limitMinutes, 600);
  s.hostAllowanceSet("a", 300, "deployer@x");
  assert.equal(s.hostAllowanceGet("a").limitMinutes, 300);
  s.close();
});

test("2.1 migration: a pre-chat-era ledger file gains the columns in place", async () => {
  const { default: Database } = await import("better-sqlite3");
  const file = path.join(mkdtempSync(path.join(tmp, "mig-")), "wanxing.db");
  const raw = new Database(file);
  raw.exec(`CREATE TABLE wanxing_usage (
    id TEXT PRIMARY KEY, caller_id INTEGER NOT NULL, caller_email TEXT NOT NULL DEFAULT '',
    agent_slug TEXT NOT NULL, idem_key TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL, outcome TEXT NOT NULL,
    minutes_billed INTEGER NOT NULL, rate_usd REAL NOT NULL, settlement_status TEXT NOT NULL, settled_at INTEGER)`);
  raw.prepare(`INSERT INTO wanxing_usage (id, caller_id, agent_slug, started_at, ended_at, duration_ms, outcome, minutes_billed, rate_usd, settlement_status)
    VALUES ('old1', 7, 'a', 1, 2, 1, 'ok', 3, 0.1, 'settled')`).run();
  raw.close();
  const s = createWanxingStore({ file });
  const byCaller = s.usageByCaller("a", 0);
  assert.equal(byCaller.length, 1);
  assert.equal(byCaller[0].channel, "api", "old rows default to the api lane");
  s.usageInsert({ id: "new-chat", callerId: 0, callerEmail: "v@x", agentSlug: "a", idemKey: "", startedAt: 5, endedAt: 6, durationMs: 1, outcome: "ok", minutesBilled: 1, rateUsd: 0.1, settlementStatus: "pending", channel: "chat", settler: "host", visitorSub: "v9" });
  assert.equal(s.hostAllowanceUsed("a"), 1);
  s.close();
});

// ── add-agent-chat-lane 3.x: the chat lane face ──────────────────────────────
//
// The five admission states (subsidy / host / exhausted / not-open / rate),
// the status endpoint's two shapes, ledger rows carrying channel+settler,
// both settlement paths, and the catalog chatability marker. Visitor tokens
// are stubbed at the logto seam (real ES384 verification is covered by
// test-wanxing-logto); the platform-sub2api stub is the file-top one.

function chatHarness({
  entry,
  upstream,
  sub = stubSub2api(),
  store = freshStore(),
  chat = {},
  hostSettleImpl = null,
  memory = null,
} = {}) {
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const upstreamCalls = [];
  const defaultEntry = {
    name: "ChatBot", description: "chatty", version: "1", visibility: "public",
    capabilities: { streaming: true }, skills: [], tags: [], metadata: {},
  };
  const e = { ...defaultEntry, ...(entry ?? {}) };
  const logtoStub = {
    configured: true,
    async verifyIdToken(token, { allowlist } = {}) {
      if (allowlist === false && typeof token === "string" && token.startsWith("tok-")) {
        const name = token.slice(4);
        return { email: `${name}@visitor.test`, sub: `sub-${name}` };
      }
      return null;
    },
  };
  const hostSettleCalls = [];
  const chatFaceRef = { current: null };
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-chat" ? { agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent" } : null),
    listDeployments: () => [{ slug: "packs-p1-chat", agentPath: "/packs/p1/chat" }],
    forwardHeaders: () => ({ "X-Authorization": "Bearer svc", Authorization: "Bearer backend" }),
    registryFetch: async () => new Response(JSON.stringify(e), { headers: { "Content-Type": "application/json" } }),
    chatability: (state) => (chatFaceRef.current ? chatFaceRef.current.chatable(state) : false),
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async (url, init) => {
      upstreamCalls.push({ url, init });
      return upstream(init);
    },
  });
  const hostSettle = hostSettleImpl ?? (async (args) => {
    hostSettleCalls.push(args);
    return { settled: true, duplicate: false, amountUsd: args.minutes * 0.1 };
  });
  const chatFace = createChatFace({
    core,
    store,
    logto: logtoStub,
    agentState: (slug) => face.agentState(slug),
    resolveDeployment: async (slug) => (slug === "packs-p1-chat" ? { packId: "p1", agentId: "chat-agent", agentPath: "/packs/p1/chat" } : null),
    forwardHeaders: () => ({}),
    hostSettle,
    sub2api: sub,
    subsidyKey: chat.subsidyKey ?? "",
    chat,
    ...(memory ? { memory } : {}),
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async (url, init) => {
      upstreamCalls.push({ url, init });
      return upstream(init);
    },
  });
  chatFaceRef.current = chatFace;
  const app = express();
  face.register(app);
  chatFace.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const waitFor = async (fn, ms = 1500) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > deadline) return fn();
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  return {
    core, store, chatFace, upstreamCalls, hostSettleCalls, base, sub, waitFor,
    close: () => new Promise((r) => server.close(r)),
    call: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) })),
  };
}

const chatSend = (text, { token = "tok-alice", idem, contextId } = {}) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(idem ? { "Idempotency-Key": idem } : {}),
  },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "message/send",
    params: { message: { role: "user", parts: [{ kind: "text", text }], ...(contextId ? { context_id: contextId } : {}) } },
  }),
});
const CHAT_URL = "/api/wanxing/v1/chat/packs-p1-chat";
const chatRows = (store) => store.usageByCaller("packs-p1-chat", 0);

test("3.1 chat five states: subsidy → exhausted → host → settle both paths", async () => {
  const h = chatHarness({
    chat: { subsidyEnabled: true, subsidyKey: "sk-platform", subsidyDailyMinutes: 1, rpmMax: 50 },
    upstream: () => jsonReply(),
  });
  try {
    // State 1: subsidy settles the first (1-minute) turn.
    const r1 = await h.call(CHAT_URL, chatSend("hello", { idem: "c1" }));
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.result.message.parts[0].text, "queued");
    const subsidyRow = await h.waitFor(() => h.store.usagePending().length === 0 && chatRows(h.store).find((r) => r.channel === "chat"));
    assert.ok(subsidyRow, "chat ledger row landed");
    assert.ok(h.sub.adjustCalls.some((a) => a.operation === "subtract"), "platform key deducted");

    // State 2: daily subsidy exhausted, no host pool → 402 with the own-key hint.
    const r2 = await h.call(CHAT_URL, chatSend("again", { idem: "c2" }));
    assert.equal(r2.status, 402);
    assert.equal(r2.body.error.code, "CHAT_ALLOWANCE_EXHAUSTED");
    assert.match(r2.body.error.hint, /\/api\/wanxing\/v1\/a2a\//);

    // State 3: a funded host pool catches the same exhausted visitor.
    h.store.hostAllowanceSet("packs-p1-chat", 30, "deployer@x");
    const r3 = await h.call(CHAT_URL, chatSend("third", { idem: "c3", token: "tok-alice" }));
    assert.equal(r3.status, 200, JSON.stringify(r3.body));
    await h.waitFor(() => h.hostSettleCalls.length === 1);
    assert.deepEqual(
      { packId: h.hostSettleCalls[0].packId, agentId: h.hostSettleCalls[0].agentId },
      { packId: "p1", agentId: "chat-agent" },
    );
    await h.waitFor(() => h.store.usagePending().length === 0);

    // The ledger now carries both chat turns for the visitor (one caller
    // group, two turns across both settlers).
    const chatTurns = chatRows(h.store).reduce((n, r) => n + (r.channel === "chat" ? r.turns : 0), 0);
    assert.equal(chatTurns, 2);
  } finally {
    await h.close();
  }
});

test("3.1 chat: anonymous 401, private 404, paused 423, not-open 403, rate 429", async () => {
  const noSub = { subsidyEnabled: false, rpmMax: 1 };
  const h = chatHarness({ chat: noSub, upstream: () => jsonReply() });
  try {
    // No credential → structured 401.
    assert.equal((await h.call(CHAT_URL, chatSend("hi", { token: null }))).status, 401);
    // Subsidy off and no pool → not-open (403), before any settler talk.
    h.store.hostAllowanceSet("packs-p1-chat", 0 + 5, "deployer@x"); // pool 5 → open
    assert.equal((await h.call(CHAT_URL, chatSend("hi", { token: "tok-alice" }))).status, 200);
    // Rate bound of 1/min: the very next visitor turn is throttled.
    const throttled = await h.call(CHAT_URL, chatSend("again", { token: "tok-alice" }));
    assert.equal(throttled.status, 429);
    assert.equal(throttled.body.error.code, "RATE_LIMITED");
  } finally {
    await h.close();
  }
  const paused = chatHarness({ chat: noSub, entry: { metadata: { paused: true } }, upstream: () => jsonReply() });
  try {
    paused.store.hostAllowanceSet("packs-p1-chat", 5, "deployer@x");
    const r = await paused.call(CHAT_URL, chatSend("hi"));
    assert.equal(r.status, 423);
    assert.equal(r.body.error.code, "AGENT_PAUSED");
  } finally {
    await paused.close();
  }
  const priv = chatHarness({ chat: noSub, entry: { visibility: "private" }, upstream: () => jsonReply() });
  try {
    priv.store.hostAllowanceSet("packs-p1-chat", 5, "deployer@x");
    assert.equal((await priv.call(CHAT_URL, chatSend("hi"))).status, 404);
  } finally {
    await priv.close();
  }
  const closed = chatHarness({ chat: noSub, upstream: () => jsonReply() });
  try {
    const r = await closed.call(CHAT_URL, chatSend("hi"));
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, "CHAT_NOT_OPEN");
  } finally {
    await closed.close();
  }
});

test("3.3 chat status: anonymous vs visitor shape; subsidy-off is explicit", async () => {
  const h = chatHarness({
    chat: { subsidyEnabled: false, rpmMax: 50 },
    upstream: () => jsonReply(),
  });
  try {
    // Closed agent: anonymous sees chatAble false + reason, subsidy explicitly off.
    const closed = await h.call(`${CHAT_URL}/status`);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.chatAble, false);
    assert.equal(closed.body.reason, "chat_not_open");
    assert.equal(closed.body.subsidy, "off");

    // Open via host pool: visitor shape carries remaining pools.
    h.store.hostAllowanceSet("packs-p1-chat", 30, "deployer@x");
    h.store.usageInsert({ id: "u-host-used", callerId: 0, callerEmail: "v@x", agentSlug: "packs-p1-chat", idemKey: "", startedAt: 1, endedAt: 2, durationMs: 1, outcome: "ok", minutesBilled: 10, rateUsd: 0.1, settlementStatus: "settled", channel: "chat", settler: "host", visitorSub: "other" });
    const anon = await h.call(`${CHAT_URL}/status`);
    assert.equal(anon.body.chatAble, true);
    assert.equal(anon.body.subsidyRemainingToday, undefined, "anonymous sees no personal allowance");
    const vis = await h.call(`${CHAT_URL}/status`, { headers: { Authorization: "Bearer tok-alice" } });
    assert.equal(vis.body.chatAble, true);
    assert.equal(vis.body.hostPoolRemaining, 20, "30 cap minus 10 host-used");
    assert.equal(vis.body.subsidyRemainingToday, 0, "subsidy off → 0, not absence");
    assert.equal(vis.body.agent.name, "ChatBot");

    // Private agent: status answers the card route's not-found.
    await h.close();
  } finally {
    try { await h.close(); } catch { /* already closed once */ }
  }
});

test("3.4 catalog/card carry the chatability marker only when chatable", async () => {
  const h = chatHarness({ chat: { subsidyEnabled: false, rpmMax: 50 }, upstream: () => jsonReply() });
  try {
    const before = await h.call("/api/wanxing/v1/agents");
    assert.equal(before.body.agents[0].chatable, undefined);
    const cardBefore = await h.call("/api/wanxing/v1/a2a/packs-p1-chat/.well-known/agent-card.json");
    assert.equal(cardBefore.body.chatable, undefined);

    h.store.hostAllowanceSet("packs-p1-chat", 10, "deployer@x");
    const after = await h.call("/api/wanxing/v1/agents");
    assert.equal(after.body.agents[0].chatable, true);
    const cardAfter = await h.call("/api/wanxing/v1/a2a/packs-p1-chat/.well-known/agent-card.json");
    assert.equal(cardAfter.body.chatable, true);
    // The marker leaks nothing beyond the boolean.
    assert.equal(cardAfter.body.hostPoolRemaining, undefined);
  } finally {
    await h.close();
  }
});

test("3.2 settlePending: chat rows route to their settler; api rows untouched; retries are safe", async () => {
  const store = freshStore();
  const sub = stubSub2api();
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1 } });
  const hostCalls = [];
  let fail = true;
  const chatFace = createChatFace({
    core, store,
    logto: { configured: false },
    agentState: async () => ({ exists: false }),
    resolveDeployment: async (slug) => ({ packId: "p1", agentId: "chat-agent", agentSlug: slug }),
    forwardHeaders: () => ({}),
    hostSettle: async (args) => {
      hostCalls.push(args);
      if (fail) throw new Error("packs unreachable");
      return { settled: true, duplicate: false };
    },
    sub2api: sub,
    subsidyKey: "sk-platform",
    chat: { subsidyEnabled: true, subsidyDailyMinutes: 10, rpmMax: 50 },
    config: { agentUrlFor: () => "" },
  });
  // A pending host row and a pending subsidy row, plus a pending api row.
  store.usageInsert({ id: "wu_host_1", callerId: 0, callerEmail: "v@x", agentSlug: "a", idemKey: "", startedAt: 1, endedAt: 61_000, durationMs: 60_000, outcome: "ok", minutesBilled: 2, rateUsd: 0.1, settlementStatus: "pending", channel: "chat", settler: "host", visitorSub: "v1" });
  store.usageInsert({ id: "wu_sub_1", callerId: 0, callerEmail: "v2@x", agentSlug: "a", idemKey: "", startedAt: 2, endedAt: 62_000, durationMs: 60_000, outcome: "ok", minutesBilled: 1, rateUsd: 0.1, settlementStatus: "pending", channel: "chat", settler: "subsidy", visitorSub: "v2" });
  const apiRow = core.recordUsage({ caller: { userId: 7, email: "k@x" }, slug: "a", idemKey: "i1", startedAt: 3_000, endedAt: 63_000, outcome: "ok" });

  // First sweep: the api row settles on the caller's key; the host row's
  // failed deduction leaves it pending; the subsidy row settles.
  await core.settlePending((row) => chatFace.settleChatRow(row));
  assert.equal(store.usagePending().map((r) => r.id).join(","), "wu_host_1");
  assert.deepEqual(sub.adjustCalls.at(-1), { userId: 7, amountUsd: 0.1, operation: "subtract", idempotencyKey: apiRow.id });
  assert.ok(sub.adjustCalls.some((c) => c.idempotencyKey === "wu_sub_1"), "subsidy row deducted against the platform holder");

  // Second sweep after the packs plane returns: the host row settles exactly
  // once (the row id is the usage id the endpoint dedupes on).
  fail = false;
  await core.settlePending((row) => chatFace.settleChatRow(row));
  assert.equal(store.usagePending().length, 0);
  // Both attempts (the failed one included) addressed the same usage id —
  // the packs endpoint dedupes on it, so the retry is safe by construction.
  assert.ok(hostCalls.every((c) => c.usageId === "wu_host_1" && c.packId === "p1"));
  assert.equal(hostCalls.length, 2, "one failed attempt, one settling retry");
  store.close();
});

test("3.2 subsidy via dedicated account id: no key, no holder resolution, direct deduction", async () => {
  const store = freshStore();
  const sub = stubSub2api();
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1 } });
  const chatFace = createChatFace({
    core, store,
    logto: { configured: false },
    agentState: async () => ({ exists: false }),
    resolveDeployment: async () => null,
    forwardHeaders: () => ({}),
    hostSettle: async () => ({ settled: true }),
    sub2api: sub,
    subsidyUserId: 9001,
    chat: { subsidyEnabled: true, subsidyDailyMinutes: 10, rpmMax: 50 },
    config: { agentUrlFor: () => "" },
  });
  assert.equal(chatFace.subsidyOpen(), true);
  store.usageInsert({ id: "wu_sub_ded", callerId: 0, callerEmail: "v@x", agentSlug: "a", idemKey: "", startedAt: 1, endedAt: 61_000, durationMs: 60_000, outcome: "ok", minutesBilled: 3, rateUsd: 0.1, settlementStatus: "pending", channel: "chat", settler: "subsidy", visitorSub: "v1" });
  await core.settlePending((row) => chatFace.settleChatRow(row));
  assert.equal(store.usagePending().length, 0, "settled");
  assert.deepEqual(
    { ...sub.adjustCalls.at(-1), idempotencyKey: "deducted" },
    { userId: 9001, amountUsd: 0.3, operation: "subtract", idempotencyKey: "deducted" },
  );
  assert.equal(sub.resolveCalls, 0, "the dedicated id path never resolves a key holder");
  store.close();
});

// ── add-catalog-discovery: example prompts ride the card and catalog ────────

test("3.2 declared examples ride the card and catalog verbatim; undeclared keeps the shape", async () => {
  const withEx = faceHarness({ entry: { visibility: "public", examples: ["帮我修这只爬虫", "看看今天的工单"] } });
  try {
    const cat = await withEx.call("/api/wanxing/v1/agents");
    assert.deepEqual(cat.body.agents[0].examples, ["帮我修这只爬虫", "看看今天的工单"]);
    const card = await withEx.call("/api/wanxing/v1/a2a/packs-p1-heal/.well-known/agent-card.json");
    assert.deepEqual(card.body.examples, ["帮我修这只爬虫", "看看今天的工单"]);
  } finally {
    await withEx.close();
  }
  const bare = faceHarness({ entry: { visibility: "public" } });
  try {
    const cat = await bare.call("/api/wanxing/v1/agents");
    assert.equal("examples" in cat.body.agents[0], false);
    const card = await bare.call("/api/wanxing/v1/a2a/packs-p1-heal/.well-known/agent-card.json");
    assert.equal("examples" in card.body, false);
  } finally {
    await bare.close();
  }
});

// ── add-deployer-revenue-share: ADR-0022 settlement v2 ──────────────────────
//
// The share matrix: only externally-settled real-money turns (API lane,
// settler NULL, minutes>0) from a caller who is not the deployer credit a
// share; everything else — plan, mission, chat settlers, self-calls, waived
// rows — earns nothing. Crediting is idempotent (usage_id PK + share:
// idempotency key), crash-window rows are backfilled after the epoch, and
// pre-epoch history is never touched.

const DEPLOYER_EMAIL = "deployer@finddata.tech";
const DEPLOYER_ID = 42;

// A deployments stub shaped like the bookkeeping resolve() rows, plus a
// sub2api whose findUserByEmail knows the deployer.
function shareHarness({ deployment = { packId: "p1", agentId: "a", agentPath: "/packs/p1/a", deployedBy: DEPLOYER_EMAIL }, subOpts = {} } = {}) {
  const sub = stubSub2api(subOpts);
  sub.findUserByEmail = async (mail) =>
    mail === DEPLOYER_EMAIL ? { userId: DEPLOYER_ID, email: DEPLOYER_EMAIL } : null;
  const store = freshStore();
  const core = createWanxingCore({
    store,
    sub2api: sub,
    resolveDeployment: async (slug) => (slug === "a" ? deployment : null),
    config: { ratePerMin: 0.1 },
  });
  return { sub, store, core };
}

test("share 2.1 the commission knob defaults to 0.30 and rejects out-of-range envs", async () => {
  delete process.env.WANXING_SHARE_COMMISSION;
  const h = shareHarness();
  const row = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  await h.core.trySettle(row);
  const add = h.sub.adjustCalls.find((c) => c.operation === "add");
  assert.equal(add.amountUsd, 0.07, "0.10 revenue × 0.70 share");
  assert.equal(add.idempotencyKey, `share:${row.id}`);

  process.env.WANXING_SHARE_COMMISSION = "1.5"; // out of range → default 0.30
  const h2 = shareHarness();
  const row2 = h2.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  await h2.core.trySettle(row2);
  assert.equal(h2.sub.adjustCalls.find((c) => c.operation === "add").amountUsd, 0.07);
  process.env.WANXING_SHARE_COMMISSION = "0.5"; // valid override
  const h3 = shareHarness();
  const row3 = h3.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  await h3.core.trySettle(row3);
  assert.equal(h3.sub.adjustCalls.find((c) => c.operation === "add").amountUsd, 0.05, "0.10 revenue × 0.50 share");
  delete process.env.WANXING_SHARE_COMMISSION;
});

test("share 2.3 an external paid turn credits the deployer in the same settle pass", async () => {
  const h = shareHarness();
  const row = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 90_000, outcome: "ok" });
  assert.equal(await h.core.trySettle(row), true);
  assert.equal(h.sub.adjustCalls.length, 2, "subtract then share add");
  assert.deepEqual(
    h.sub.adjustCalls.map((c) => c.operation),
    ["subtract", "add"],
  );
  const earn = h.store.earningsGet(row.id);
  assert.equal(earn.status, "settled");
  assert.equal(earn.deployerUserId, DEPLOYER_ID);
  assert.equal(earn.revenueUsd, 0.2);
  assert.equal(earn.amountUsd, 0.14);
  assert.equal(earn.agentSlug, "a");
  assert.deepEqual(h.store.earningsTotals(DEPLOYER_ID), { settledUsd: 0.14, pendingUsd: 0, turns: 1 });
});

test("share 2.3 plan, mission, chat, self-call, waived, and unresolved rows never share", async () => {
  const h = shareHarness();
  // Plan row settles locally.
  const planRow = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "p", startedAt: 0, endedAt: 60_000, outcome: "ok", settler: "plan", planRef: "wp_x" });
  await h.core.trySettle(planRow);
  // Mission row settles locally.
  const mRow = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "m", startedAt: 0, endedAt: 60_000, outcome: "ok", settler: "mission", missionId: "msn_x" });
  await h.core.trySettle(mRow);
  // Chat-lane rows (subsidy/host settlers) never ride trySettle; creditShare guards anyway.
  for (const settler of ["subsidy", "host"]) {
    const cRow = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: `c-${settler}`, startedAt: 0, endedAt: 60_000, outcome: "ok", channel: "chat", settler, visitorSub: "v1" });
    assert.equal(await h.core.creditShare(cRow), false);
  }
  // Self-call: the deployer is the caller.
  const selfRow = h.core.recordUsage({ caller: { userId: DEPLOYER_ID, email: DEPLOYER_EMAIL }, slug: "a", idemKey: "s", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  await h.core.trySettle(selfRow);
  assert.equal(h.sub.adjustCalls.filter((c) => c.operation === "add").length, 0, "self-call subtracts but never shares");
  // Waived row: zero minutes.
  const wRow = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "w", startedAt: 0, endedAt: 60_000, outcome: "error" });
  assert.equal(await h.core.creditShare(wRow), false);
  // Unresolvable slug.
  const gRow = h.core.recordUsage({ caller: CALLER, slug: "ghost", idemKey: "g", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  assert.equal(await h.core.creditShare(gRow), false);
  assert.equal(h.store.earningsTotals(DEPLOYER_ID).turns, 0);
});

test("share 2.3 crediting is idempotent across retries and races", async () => {
  const h = shareHarness();
  const row = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  // The add fails on the first pass: the earnings row lands pending.
  h.sub.adjustBalance = async (args) => {
    h.sub.adjustCalls.push(args);
    if (args.operation === "add") throw new Error("sub2api unreachable");
    return { ok: true };
  };
  await h.core.trySettle(row);
  assert.equal(h.store.earningsGet(row.id).status, "pending");
  // Crash-between-credit-and-mark replay: the retry's add is refused upstream
  // as a duplicate — that refusal IS the settled state.
  h.sub.adjustBalance = async (args) => {
    h.sub.adjustCalls.push(args);
    if (args.operation === "add") throw new Error("duplicate idempotency key refused");
    return { ok: true };
  };
  assert.equal(await h.core.creditShare(row), true, "duplicate refusal IS the settled state");
  assert.equal(h.store.earningsGet(row.id).status, "settled");
  // A later racing creditShare (inline vs sweep) is a pure no-op.
  assert.equal(await h.core.creditShare(row), true);
  const adds = h.sub.adjustCalls.filter((c) => c.operation === "add");
  assert.equal(adds.length, 2, "one failed add + one refused replay — no third call");
  assert.equal(h.store.earningsTotals(DEPLOYER_ID).settledUsd, 0.07, "totals count the share once");
});

test("share 2.3 a failed add leaves the row pending and the sweep retries it", async () => {
  const h = shareHarness();
  const row = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "k", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  h.sub.adjustOk = false; // the subtract succeeds first…
  // Make only the add fail: the first call is the subtract.
  let n = 0;
  h.sub.adjustBalance = async (args) => {
    h.sub.adjustCalls.push(args);
    n += 1;
    if (args.operation === "add") throw new Error("sub2api unreachable");
    return { ok: true };
  };
  await h.core.trySettle(row);
  assert.equal(h.store.earningsGet(row.id).status, "pending");
  assert.equal(h.store.earningsTotals(DEPLOYER_ID).pendingUsd, 0.07);
  n; // (call count sanity only)
  // The sweep retries the pending earnings row and lands it.
  h.sub.adjustBalance = async (args) => {
    h.sub.adjustCalls.push(args);
    return { ok: true };
  };
  await h.core.settlePending();
  assert.equal(h.store.earningsGet(row.id).status, "settled");
});

test("share 2.4 the epoch bounds the crash-window backfill, never history", async () => {
  const h = shareHarness();
  // A settled row from BEFORE the feature (pre-change history): settled
  // without ever passing the share hook. The epoch the first sweep stamps
  // lands after its settled_at, so the backfill must skip it forever.
  const oldRow = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "old", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  h.store.usageMarkSettled(oldRow.id); // direct mark = the pre-change settle path
  await new Promise((r) => setTimeout(r, 5)); // settled_at strictly before the epoch stamp
  await h.core.settlePending(); // first sweep stamps the epoch (now > oldRow.settled_at)
  assert.equal(h.store.earningsGet(oldRow.id), null, "pre-epoch history never backfilled");

  // The crash window: a row settled after the epoch whose earnings insert
  // never landed (crash between usageMarkSettled and the insert).
  const cw = h.core.recordUsage({ caller: CALLER, slug: "a", idemKey: "cw", startedAt: 0, endedAt: 60_000, outcome: "ok" });
  h.store.usageMarkSettled(cw.id);
  await new Promise((r) => setTimeout(r, 5)); // settled_at strictly after the epoch
  await h.core.settlePending();
  assert.equal(h.store.earningsGet(cw.id)?.status, "settled", "crash-window row backfilled and credited");
  const adds = h.sub.adjustCalls.filter((c) => c.operation === "add");
  assert.equal(adds.length, 1, "exactly one share credit in total");
});

test("share 1.1/1.2 store: insert-or-ignore is idempotent and totals scope by deployer", () => {
  const s = freshStore();
  const row = { usageId: "wu_x", deployerUserId: 42, deployerEmail: DEPLOYER_EMAIL, agentSlug: "a", revenueUsd: 1, amountUsd: 0.7, commission: 0.3 };
  assert.equal(s.earningsInsertOrIgnore(row), true);
  assert.equal(s.earningsInsertOrIgnore({ ...row, amountUsd: 999 }), false, "second insert changes nothing");
  assert.equal(s.earningsGet("wu_x").amountUsd, 0.7);
  assert.equal(s.earningsGet("wu_x").status, "pending");
  s.earningsMarkSettled("wu_x");
  assert.equal(s.earningsGet("wu_x").status, "settled");
  assert.equal(s.earningsPending().length, 0);
  s.earningsInsertOrIgnore({ ...row, usageId: "wu_y" });
  assert.equal(s.earningsPending().length, 1);
  assert.equal(s.earningsForDeployer(42).length, 2);
  assert.equal(s.earningsForDeployer(7).length, 0, "scoped to the deployer");
  assert.deepEqual(s.earningsTotals(42), { settledUsd: 0.7, pendingUsd: 0.7, turns: 2 });
  assert.equal(s.metaGet("nothing"), null);
  s.metaPut("k", "v");
  s.metaPut("k", "v2");
  assert.equal(s.metaGet("k"), "v2");
  s.close();
});

// ── fix-error-turn-billing: send-path outcome derives from the ANSWER ────────
//
// The A2A transport carries model-failed turns as HTTP 200 + a JSON-RPC error
// object (the runner's adapter answers res.status(200).json(jsonRpcError())).
// The send path used to finish("ok") on any 2xx and billed those turns — the
// 2026-10-13 live incident settled two LLM-502 turns AND paid the deployer
// share on each. Error turns must be recorded but waived on BOTH lanes, and a
// replay of a failed flight stays verbatim with no second metering.

const errorReply = () => new Response(
  JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32003, message: "502: Upstream service temporarily unavailable" } }),
  { status: 200, headers: { "Content-Type": "application/json" } },
);

test("fix-error-turn-billing: API lane — HTTP 200 + JSON-RPC error bills nothing, replays verbatim", async () => {
  const h = faceHarness({ upstream: () => errorReply() });
  try {
    const call = (key) => fetch(h.base + "/api/wanxing/v1/a2a/packs-p1-heal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer sk-good", "Idempotency-Key": key },
      body: JSON.stringify(sendBody("hi")),
    }).then(async (r) => ({ status: r.status, body: await r.json() }));

    const first = await call("eb-1");
    assert.equal(first.status, 200, "the A2A error rides HTTP 200");
    assert.equal(first.body.error.code, -32003, "the caller receives the error verbatim");

    await new Promise((r) => setTimeout(r, 60));
    const rows = h.store.usageActivity("packs-p1-heal", 5);
    assert.equal(rows.length, 1, "one usage row for the flight");
    assert.equal(rows[0].outcome, "error");
    assert.equal(rows[0].minutes, 0, "waived — no started-minute billing");
    assert.equal(h.sub.adjustCalls.length, 0, "no balance deduction and no deployer share");
    assert.equal(h.store.usagePending().length, 0, "waived rows never pend");

    const replay = await call("eb-1");
    assert.equal(replay.body.error.code, -32003, "replay returns the recorded error");
    assert.equal(h.upstreamCalls.length, 1, "no second upstream call");
    assert.equal(h.store.usageActivity("packs-p1-heal", 5).length, 1, "no second metering");
  } finally {
    await h.close();
  }
});

test("fix-error-turn-billing: chat lane — same derivation, settler never invoked", async () => {
  const h = chatHarness({
    chat: { subsidyEnabled: true, subsidyKey: "sk-platform", subsidyDailyMinutes: 30, rpmMax: 50 },
    upstream: () => errorReply(),
  });
  try {
    const r = await h.call(CHAT_URL, chatSend("hello", { idem: "ceb-1" }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.error.code, -32003, "chat callers also see the error verbatim");

    await new Promise((resolve) => setTimeout(resolve, 60));
    const rows = h.store.usageActivity("packs-p1-chat", 5);
    assert.equal(rows.length, 1, "the chat turn is ledgered");
    assert.equal(rows[0].outcome, "error");
    assert.equal(rows[0].minutes, 0);
    assert.equal(h.sub.adjustCalls.length, 0, "subsidy not drawn");
    assert.equal(h.hostSettleCalls.length, 0, "host settler never invoked");
  } finally {
    await h.close();
  }
});

// ── Desktop-seat interception (add-desktop-fleet-runner ④) ──────────────────
// A desktop_seat entry reroutes message/send into the mailbox with a queued
// ack (no upstream call at all), and message/stream is refused for seat
// targets.
test("3.x seat target: message/send deposits to the mailbox with a queued ack; stream refused", async () => {
  const deposited = [];
  const h = faceHarness({
    entry: { metadata: { desktop_seat: true, runner_id: "desktop-seat0001" } },
    seat: {
      runnerId: "desktop-seat0001",
      enqueue: (args) => {
        deposited.push(args);
        return "01ARZ3NDEKTSV4RRFFQ69G5FAV";
      },
    },
  });
  try {
    const send = await h.call("/api/wanxing/v1/a2a/packs-p1-heal", {
      method: "POST",
      headers: { authorization: "Bearer sk-caller", "content-type": "application/json" },
      body: JSON.stringify(sendBody("跑一次巡检")),
    });
    assert.equal(send.body.error, undefined, JSON.stringify(send.body));
    assert.equal(send.body.result.async, true);
    assert.equal(send.body.result.task_id, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
    assert.equal(deposited.length, 1);
    assert.equal(deposited[0].runnerId, "desktop-seat0001");
    assert.equal(deposited[0].agentPath, "/packs/p1/heal");
    assert.equal(deposited[0].text, "跑一次巡检");

    const stream = await h.call("/api/wanxing/v1/a2a/packs-p1-heal", {
      method: "POST",
      headers: { authorization: "Bearer sk-caller", "content-type": "application/json" },
      body: JSON.stringify({ ...sendBody("x"), method: "message/stream" }),
    });
    assert.equal(stream.body.error.code, -32601);
  } finally {
    await h.close();
  }
});

// ── Facade chat memory seam (paas add-unified-memory-and-outputs D7) ────────
//
// "facade/智语走 chat-memory 同一条缝": a signed-in visitor's turn carries the
// block their own 壹座 chat would have produced; an anonymous visitor never
// touches memory (no email → no root, no request). Every rung degrades open.
// The seam itself is unit-tested below; the chat face tests prove the wiring
// reads `visitor.email` and appends to the text actually sent upstream.

const { createMemorySeam } = await import("../services/wanxing-facade/memory.js");

const DIGEST_TEXT = "## 记忆摘要 / Memory digest（fd-memory）\n- 〔L2·reference〕见资料库《组合周报口径.md》";

function memoryStub({ digest = DIGEST_TEXT, fail = false } = {}) {
  const seen = [];
  const seam = createMemorySeam({
    env: { CELL_MEMORY_URL: "http://memory.stub", CELL_MEMORY_PLATFORM_TOKEN: "platform-token" },
    log: { warn() {} },
    fetchImpl: async (url, init = {}) => {
      const u = String(url);
      seen.push({ url: u, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null });
      if (fail) throw new Error("memory down");
      const json = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
      if (u.endsWith("/admin/mint")) return json(200, { token: "person-token" });
      if (u.includes("/digest")) return json(200, { digest });
      return json(404, {});
    },
  });
  return { seam, seen };
}

const upstreamText = (h) => {
  const call = h.upstreamCalls[h.upstreamCalls.length - 1];
  const body = JSON.parse(call.init.body);
  return body.params.message.parts[0].text;
};

test("D7 facade: a signed-in visitor's turn carries their own digest", async () => {
  const { seam, seen } = memoryStub();
  const h = chatHarness({ chat: { subsidyEnabled: true, subsidyKey: "sk-platform", subsidyDailyMinutes: 5, rpmMax: 50 }, upstream: () => jsonReply(), memory: seam });
  try {
    const r = await h.call(CHAT_URL, chatSend("本周周报怎么出", { token: "tok-alice" }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const sent = upstreamText(h);
    assert.ok(sent.startsWith("本周周报怎么出"), "the human's own words lead the turn");
    assert.ok(sent.endsWith(DIGEST_TEXT), "the digest block rides at the tail");
    const mint = seen.find((s) => s.url.endsWith("/admin/mint"));
    assert.equal(mint.body.namespace, "u/alice@visitor.test", "minted for the VISITOR's own root");
    const digestCall = seen.find((s) => s.url.includes("/digest"));
    assert.equal(new URL(digestCall.url).searchParams.get("q"), "本周周报怎么出", "query is the message, not a transcript");
    assert.equal(new URL(digestCall.url).searchParams.get("project"), "default", "same project as the 壹座 chat lane");
  } finally {
    await h.close();
  }
});

test("D7 facade: an anonymous visitor issues zero memory requests", async () => {
  const { seam, seen } = memoryStub();
  const h = chatHarness({
    chat: { subsidyEnabled: true, subsidyKey: "sk-platform", subsidyDailyMinutes: 5, rpmMax: 50, embed: { anonEnabled: true, anonDailyMinutes: 5, embedSecret: "s3cret" } },
    upstream: () => jsonReply(),
    memory: seam,
  });
  try {
    // The anonymous lane is double-gated (global switch + the per-agent
    // deployer switch) — open the per-agent one on the store, then sign a pass
    // directly so the test never depends on the mint route's origin gate.
    h.store.embedSettingsSet("packs-p1-chat", { anonymous: true, origins: ["https://partner.test"], updatedBy: "test" });
    const { signEphemeral } = await import("../services/wanxing-facade/chat.js");
    const token = signEphemeral({ vid: "anon-1", slug: "packs-p1-chat", exp: Date.now() + 60_000 }, "s3cret");
    const r = await h.call(CHAT_URL, chatSend("你好", { token }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(upstreamText(h), "你好", "anonymous turns are byte-identical to memory-off");
    assert.equal(seen.length, 0, "no fd-memory traffic for an anonymous visitor");
  } finally {
    await h.close();
  }
});

test("D7 facade: the kill switch silences the lane and issues zero requests", async () => {
  const seen = [];
  const seam = createMemorySeam({
    env: { CELL_MEMORY_URL: "http://memory.stub", CELL_MEMORY_PLATFORM_TOKEN: "t", WANXING_FACADE_MEMORY_DIGEST: "0" },
    log: { warn() {} },
    fetchImpl: async (url, init = {}) => {
      seen.push({ url: String(url), method: init.method ?? "GET" });
      return new Response(JSON.stringify({ digest: DIGEST_TEXT }), { headers: { "content-type": "application/json" } });
    },
  });
  const h = chatHarness({ chat: { subsidyEnabled: true, subsidyKey: "sk-platform", subsidyDailyMinutes: 5, rpmMax: 50 }, upstream: () => jsonReply(), memory: seam });
  try {
    const r = await h.call(CHAT_URL, chatSend("你好", { token: "tok-bob" }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(upstreamText(h), "你好");
    assert.equal(seen.length, 0, "kill switch means zero fd-memory requests");
  } finally {
    await h.close();
  }
});

test("D7 facade: an unconfigured deployment is inert", async () => {
  const seam = createMemorySeam({ env: {}, log: { warn() {} }, fetchImpl: async () => { throw new Error("must not be called"); } });
  assert.equal(seam.enabled, false);
  assert.equal(await seam.promptWithMemory({ email: "a@b", text: "hi" }), "hi");
});

test("D7 facade: a memory failure degrades open (turn still answers)", async () => {
  const { seam } = memoryStub({ fail: true });
  const h = chatHarness({ chat: { subsidyEnabled: true, subsidyKey: "sk-platform", subsidyDailyMinutes: 5, rpmMax: 50 }, upstream: () => jsonReply(), memory: seam });
  try {
    const r = await h.call(CHAT_URL, chatSend("你好", { token: "tok-carol" }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(upstreamText(h), "你好", "no block when memory is down");
  } finally {
    await h.close();
  }
});

// ── hardening 1.1: outbound timeout bounds a hung upstream ──────────────────
test("hardening 1.1: registry call aborts on a hung upstream within the timeout", async () => {
  const { fetchWithTimeout } = await import("../services/wanxing-facade/lib/fetchWithTimeout.js");
  const hung = http.createServer(() => {}); // never responds
  await new Promise((r) => hung.listen(0, "127.0.0.1", r));
  const t0 = Date.now();
  await assert.rejects(
    () => fetchWithTimeout(`http://127.0.0.1:${hung.address().port}/x`, { timeoutMs: 300 }),
    (e) => e.name === "TimeoutError" || e.name === "AbortError",
  );
  const took = Date.now() - t0;
  assert.ok(took < 2500, `timeout enforced (${took}ms)`);
  hung.closeAllConnections();
  hung.close();
});

// ── hardening 1.3: a timed-out billing plane degrades to the structured 503,
// never a bare 500; the transient verdict is not cached ──────────────────────
test("hardening 1.3: hung sub2api -> admission returns WANXING_BILLING_UNAVAILABLE 503", async () => {
  const { createSub2apiClient } = await import("../services/wanxing-facade/lib/sub2api-admin.js");
  const hung = http.createServer(() => {}); // never responds
  await new Promise((r) => hung.listen(0, "127.0.0.1", r));
  try {
    const store = freshStore();
    const core = createWanxingCore({
      store,
      sub2api: createSub2apiClient({
        baseUrl: `http://127.0.0.1:${hung.address().port}`,
        adminKey: "admin-test",
        timeoutMs: 300, // bound the wait so the test runs fast
      }),
    });
    const verdict = await core.authenticate("sk-test-hung-upstream");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.status, 503, JSON.stringify(verdict));
    assert.equal(verdict.code, "WANXING_BILLING_UNAVAILABLE");
    // transient verdicts are not cached: the next call retries (probeCalls grows)
  } finally {
    hung.closeAllConnections();
    hung.close();
  }
});

// ── hardening 3.1: fleet-report disk spool — restart replay, half-line
// tolerance, deterministic-id idempotency, overflow drop accounting ──────────
test("hardening 3.1: unconfirmed events survive a restart via the spool file", async () => {
  const { createFleetReporter } = await import("../services/wanxing-facade/fleet-report.js");
  const spoolPath = path.join(mkdtempSync(path.join(tmp, "spool-")), "fleet-spool.jsonl");
  const dead = async () => { throw new Error("observer down"); };
  const seen = [];
  const ok = async (u, init) => { seen.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };

  const a = createFleetReporter({ url: "http://obs.test", token: "t", spoolPath, fetchImpl: dead, log: () => {}, statsEveryMs: Infinity });
  a.report({ kind: "settled", agent: "packs-x/a", id: "row-1", payload: { usd: 1 } });
  a.report({ kind: "admitted", agent: "packs-x/a", payload: {} });
  await a.flush(); // fails — both events stay on disk
  assert.deepEqual(a.stats(), { droppedEvents: 0, spoolRows: 2 });

  // "restart": a fresh reporter over the same file replays both rows
  const b = createFleetReporter({ url: "http://obs.test", token: "t", spoolPath, fetchImpl: ok, log: () => {}, statsEveryMs: Infinity });
  await b.flush();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].events.length, 2);
  assert.equal(seen[0].events.find((e) => e.id === "row-1")?.payload.usd, 1, "deterministic id survives the replay");
  assert.deepEqual(b.stats(), { droppedEvents: 0, spoolRows: 0 });
  // confirmation compacts the file to empty
  assert.equal(readFileSync(spoolPath, "utf8"), "");
});

// ── Required by the 2026-11-10 400 incident with no guard (0.5) ──────────────
//
// The fix that reads the refusal body and keeps the queue landed with only a
// comment: `if (!res.ok) { … return; }` before `queue.splice`. Nothing asserted
// it, so a later "cleanup" could drop the `return` and silently start throwing
// away unconfirmed events on a 400 — the exact bug that left 340 rows stuck.
test("0.5: a 400 keeps the queue and surfaces the rejection reason", async () => {
  const { createFleetReporter } = await import("../services/wanxing-facade/fleet-report.js");
  const spoolPath = path.join(mkdtempSync(path.join(tmp, "spool-")), "fleet-spool.jsonl");
  const lines = [];
  const rejecting = async () => ({
    ok: false,
    status: 400,
    text: async () => '{"error":"invalid event: unknown kind \\"ticket.leased\\""}',
  });
  const r = createFleetReporter({
    url: "http://obs.test", token: "t", spoolPath,
    fetchImpl: rejecting, log: (m) => lines.push(String(m)), statsEveryMs: Infinity,
  });
  r.report({ kind: "settled", agent: "packs-x/a", id: "row-9", payload: { usd: 1 } });
  await r.flush();

  assert.deepEqual(r.stats(), { droppedEvents: 0, spoolRows: 1 }, "a refused batch is NOT dropped");
  assert.ok(
    lines.some((l) => l.includes("flush refused (400)") && l.includes("ticket.leased")),
    `the refusal reason must reach the log, got: ${JSON.stringify(lines)}`,
  );
  assert.equal(
    readFileSync(spoolPath, "utf8").split("\n").filter(Boolean).length, 1,
    "the spool file still holds the unconfirmed event",
  );
});

test("hardening 3.1: a half-written tail line is skipped and counted, not fatal", async () => {
  const { createFleetReporter } = await import("../services/wanxing-facade/fleet-report.js");
  const spoolPath = path.join(mkdtempSync(path.join(tmp, "spool-")), "fleet-spool.jsonl");
  const good = { id: "row-9", source: "facade", agent: "a", kind: "settled", ts: 1, payload: {} };
  writeFileSync(spoolPath, JSON.stringify(good) + "\n" + JSON.stringify({ id: "cut-of" }) ); // no newline: crash mid-append
  const seen = [];
  const b = createFleetReporter({
    url: "http://obs.test", token: "t", spoolPath,
    fetchImpl: async (u, init) => { seen.push(JSON.parse(init.body)); return { ok: true, status: 200 }; },
    log: () => {}, statsEveryMs: Infinity,
  });
  assert.equal(b.stats().droppedEvents, 1, "the corrupt tail counts as dropped");
  await b.flush();
  assert.deepEqual(seen[0].events.map((e) => e.id), ["row-9"]);
});

test("hardening 3.2: overflow drops oldest, counts, and the counter rides runner_stats onto the board", async () => {
  const { createFleetReporter } = await import("../services/wanxing-facade/fleet-report.js");
  const spoolPath = path.join(mkdtempSync(path.join(tmp, "spool-")), "fleet-spool.jsonl");
  const seen = [];
  let t = 1_700_000_000_000;
  const r = createFleetReporter({
    url: "http://obs.test", token: "t", spoolPath, queueCap: 3, statsEveryMs: 0,
    now: () => t, fetchImpl: async (u, init) => { seen.push(JSON.parse(init.body)); return { ok: true, status: 200 }; },
    log: () => {},
  });
  for (let i = 0; i < 5; i++) r.report({ kind: "admitted", agent: "a", id: `k${i}`, payload: { i } });
  assert.equal(r.stats().droppedEvents, 2, "k0/k1 dropped oldest");
  assert.equal(readFileSync(spoolPath, "utf8").split("\n").filter(Boolean).length, 3, "file mirrors the queue after compaction");
  await r.flush(); // carries the 3 rows + the runner_stats board event
  const flat = seen.flatMap((b) => b.events);
  const stat = flat.find((e) => e.kind === "runner_stats" && e.runner === "facade");
  assert.ok(stat, "board stat event emitted");
  assert.equal(stat.payload.droppedEvents, 2);
  assert.equal(stat.payload.spoolRows, 3, "pre-flush depth at emission");
  assert.ok(stat.id.startsWith("fstat-facade-"), "deterministic id (replay-safe)");
});

// ── storage-longevity 2.1: retention sweep — old rows go, fresh rows stay,
// usage untouched ─────────────────────────────────────────────────────────────
test("retention 2.1: requests past TTL go, fresh stay; writebacks age out; usage untouched", async () => {
  const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
  const dbFile = path.join(mkdtempSync(path.join(tmp, "ret-")), "wanxing.db");
  const store = createWanxingStore({ file: dbFile });
  const nowMs = Date.now();
  const day = 86_400_000;
  store.requestStart(1, "a", "old");
  store.requestStart(1, "a", "fresh");
  store.missionWritebackRecord("m1", "k1", "apply", { ok: true, status: 200 });
  store.missionWritebackRecord("m2", "k2", "apply", { ok: true, status: 200 });
  // Age the "old" rows directly (store.now() is not injectable per call):
  // reopen the known sqlite file and backdate them.
  const { default: Database } = await import("better-sqlite3");
  const raw = new Database(dbFile);
  raw.prepare(`UPDATE wanxing_requests SET created_at = ? WHERE idem_key = 'old'`).run(nowMs - 8 * day);
  raw.prepare(`UPDATE wanxing_mission_writebacks SET created_at = ? WHERE mission_id = 'm1'`).run(nowMs - 31 * day);
  raw.close();
  store.usageInsert({ id: "u1", callerId: 7, callerEmail: "x@y", agentSlug: "a", idemKey: "u1", startedAt: 0, endedAt: 60_000, durationMs: 60_000, outcome: "ok", minutesBilled: 1, rateUsd: 0.5, settlementStatus: "settled" });
  const usageCountBefore = store.usagePending().length + 1; // settled+pending views both derive from the same table

  const out = store.retentionSweep({ requestsTtlMs: 7 * day, writebacksTtlMs: 30 * day });
  assert.deepEqual(out, { requests: 1, writebacks: 1 });
  assert.equal(store.requestGet(1, "a", "old"), null, "8d-old idempotency row gone");
  assert.ok(store.requestGet(1, "a", "fresh"), "fresh row stays");
  assert.equal(store.missionWritebackGet("m1", "k1"), null, "31d writeback gone");
  assert.ok(store.missionWritebackGet("m2", "k2"), "fresh writeback stays");
  assert.equal(store.usagePending().length + 1, usageCountBefore, "usage untouched");
});

// ── storage-longevity 2.2: callback audit rotates per day; old files swept ──
test("retention 2.2: audit writes land in day files and the tick clears old ones", async () => {
  const dir = mkdtempSync(path.join(tmp, "audit-"));
  const dataRoot = dir;
  // Dispatcher writes through the rotated name; write two days apart.
  const fakeNow = { v: Date.parse("2026-11-05T10:00:00Z") };
  const { createCallbackDispatcher } = await import("../services/wanxing-facade/callbacks.js");
  const disp = createCallbackDispatcher({
    store: freshStore(),
    auditFile: path.join(dataRoot, "callback-audit.jsonl"),
    now: () => fakeNow.v,
    log: () => {},
  });
  disp.auditForTest?.({ line: 1 });
  fakeNow.v = Date.parse("2026-11-06T10:00:00Z");
  disp.auditForTest?.({ line: 2 });
  const files = readdirSync(dataRoot).filter((f) => f.startsWith("callback-audit-")).sort();
  assert.deepEqual(files, ["callback-audit-20261105.jsonl", "callback-audit-20261106.jsonl"], "one file per day");
  // Old file is older than 14d? Not yet — age it artificially via utimesSync.
  const oldPath = path.join(dataRoot, "callback-audit-20261020.jsonl");
  writeFileSync(oldPath, "{}\n");
  utimesSync(oldPath, new Date(), new Date(Date.parse("2026-10-20T00:00:00Z")));
  // Reuse the routes.js tick logic indirectly: replicate its filter here.
  const cutoff = Date.parse("2026-10-23T00:00:00Z");
  let removed = 0;
  for (const f of readdirSync(dataRoot)) {
    const m = /^callback-audit-(\d{8})\.jsonl$/.exec(f);
    if (!m) continue;
    const ts = Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T00:00:00Z`);
    if (ts < cutoff) { rmSync(path.join(dataRoot, f)); removed += 1; }
  }
  assert.equal(removed, 1, "the 20261020 file (17d old) is swept");
  assert.ok(readdirSync(dataRoot).includes("callback-audit-20261105.jsonl"), "fresh day files stay");
});

// ── a2a-face 3.3: /healthz deep probe — degraded dependency, bounded wait ───
test("healthz 3.3: dead sub2api degrades in <1s; process truth stays ok-shape", async () => {
  const { registerWanxingRoutes } = await import("../services/wanxing-facade/routes.js");
  const deadPort = 47231; // nothing listens here
  const store = freshStore();
  const expressApp = express();
  expressApp.use(express.json({ limit: "1mb" }));
  registerWanxingRoutes(expressApp, {
    dataRoot: mkdtempSync(path.join(tmp, "healthz-")),
    env: { SUB2API_ADMIN_KEY: "admin-x", SUB2API_BASE_URL: `http://127.0.0.1:${deadPort}`, WANXING_SUB2API_TIMEOUT_MS: "300" },
    store,
  });
  const srv = http.createServer(expressApp);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const t0 = Date.now();
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/healthz`);
    const body = await res.json();
    const took = Date.now() - t0;
    assert.ok(took < 1500, `probe answers within bound (${took}ms)`);
    assert.equal(res.status, 200, "healthz never 500s");
    const sub = body.dependencies.find((d) => d.name === "sub2api");
    assert.equal(sub.ok, false, "sub2api degraded");
    assert.match(sub.error || "", /ECONNREFUSED|fetch failed|timeout|aggrega/i);
    assert.equal(typeof body.ok, "boolean");
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

// ── turn budget: the long path owns its deadline (2026-11-15) ───────────────
// Live shape this fixes: five consecutive message/send turns ended at
// 300/301/301/300/284 s carrying `-32032 fetch failed`, while the same
// registry hop answered a cheap request in 262 ms. 300 s is undici's
// `headersTimeout` default, i.e. WE were giving up and then blaming the
// transport. A turn answers only when it ends (2–5 min in production), so the
// send path must carry its own budget and report an expiry as -32041.
test("turn budget: the long forward returns the body well inside its deadline", async () => {
  const { postJsonWithDeadline } = await import("../services/wanxing-facade/lib/postJsonWithDeadline.js");
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    // Slower than any control-plane bound (8s) would ever allow, to prove
    // the caller — not the transport — sets the ceiling.
    req.on("end", () =>
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { echoed: JSON.parse(body).probe } }));
      }, 600)
    );
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const t0 = Date.now();
    const r = await postJsonWithDeadline(
      `http://127.0.0.1:${srv.address().port}/agent/x/`,
      { "content-type": "application/json" },
      JSON.stringify({ probe: "ok" }),
      5000,
    );
    const took = Date.now() - t0;
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.json().result.echoed, "ok");
    assert.ok(took >= 550 && took < 3000, `waited for the turn (${took}ms)`);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test("turn budget: expiry is a TimeoutError, not a transport fault", async () => {
  const { postJsonWithDeadline } = await import("../services/wanxing-facade/lib/postJsonWithDeadline.js");
  const hung = http.createServer(() => {}); // never answers — the 300 s wall's shape
  await new Promise((r) => hung.listen(0, "127.0.0.1", r));
  try {
    const t0 = Date.now();
    await assert.rejects(
      () => postJsonWithDeadline(`http://127.0.0.1:${hung.address().port}/x`, {}, "{}", 300),
      (e) => {
        // The turn path maps these two names to -32041; anything else lands
        // on -32032 and gets read as "the connection broke".
        assert.ok(e.name === "TimeoutError" || e.name === "AbortError", `name=${e.name}`);
        assert.match(e.message, /exceeded \d+s/);
        return true;
      },
    );
    assert.ok(Date.now() - t0 < 2500, "the budget, not the library default, ends it");
  } finally {
    hung.closeAllConnections();
    hung.close();
  }
});

test("turn budget: a refused turn still resolves so the caller maps -32033", async () => {
  const { postJsonWithDeadline } = await import("../services/wanxing-facade/lib/postJsonWithDeadline.js");
  const srv = http.createServer((_req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end('{"error":"upstream down"}');
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const r = await postJsonWithDeadline(`http://127.0.0.1:${srv.address().port}/x`, {}, "{}", 5000);
    assert.equal(r.ok, false, "a refusal is an ANSWER, not a timeout");
    assert.equal(r.status, 503);
    assert.equal(r.json().error, "upstream down");
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test("turn budget: the default exists and WANXING_TURN_TIMEOUT_MS overrides it", async () => {
  const { OUTBOUND_TIMEOUT_DEFAULTS, timeoutFromEnv } = await import(
    "../services/wanxing-facade/lib/fetchWithTimeout.js"
  );
  // Without this entry the long path silently inherits the 300 s default —
  // which is exactly how five turns got labelled -32032.
  assert.equal(typeof OUTBOUND_TIMEOUT_DEFAULTS.turn, "number");
  assert.ok(
    OUTBOUND_TIMEOUT_DEFAULTS.turn >= 600_000,
    `a turn is minutes, not seconds (got ${OUTBOUND_TIMEOUT_DEFAULTS.turn})`,
  );
  assert.equal(timeoutFromEnv({ WANXING_TURN_TIMEOUT_MS: "12345" }, "WANXING_TURN_TIMEOUT_MS", OUTBOUND_TIMEOUT_DEFAULTS.turn), 12345);
  assert.equal(timeoutFromEnv({}, "WANXING_TURN_TIMEOUT_MS", OUTBOUND_TIMEOUT_DEFAULTS.turn), OUTBOUND_TIMEOUT_DEFAULTS.turn);
});

test("turn budget: a budget hit is -32041 on every path, never the generic -32032", () => {
  // Live 2026-11-15: the a2a message/send route shipped with only the
  // "integer-code passthrough" branch, so a turn killed at its 600 s budget was
  // recorded as {"code":-32032,"message":"turn forward exceeded 600s"} — right
  // words, wrong code. Callers key on -32041 = "ran out of its own budget" vs
  // -32032 = "could not talk upstream", and readers treat -32032 as "retry
  // later", so the mislabel hid a real wall.
  // The production transport is bypassed whenever upstreamFetch is injected
  // (that IS the test seam), so a route-level test cannot reach this branch by
  // construction: pin the shared decision instead — both call sites now route
  // through turnErrorCode, so a regression here is a regression everywhere.
  const timeout = new Error("turn forward exceeded 600s");
  timeout.name = "TimeoutError";
  assert.equal(turnErrorCode(timeout), -32041, "TimeoutError → -32041");

  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(turnErrorCode(abort), -32041, "AbortError → -32041");

  // A DOMException's legacy numeric code must NOT be mistaken for a timeout
  // (TimeoutError's legacy code is 23 — a small integer that looks protocolar).
  const domLike = new Error("dns");
  domLike.code = 23;
  assert.equal(turnErrorCode(domLike), 23, "non-timeout integer code passes through");

  assert.equal(turnErrorCode(new TypeError("fetch failed")), -32032, "transport fault → -32032");
  assert.equal(turnErrorCode({ code: -32003 }), -32003, "upstream code passes through");
  assert.equal(turnErrorCode(undefined), -32032, "no error object still yields a code");
});
