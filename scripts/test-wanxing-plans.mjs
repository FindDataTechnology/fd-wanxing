#!/usr/bin/env node
// ── Serving-plan tests (add-serving-plans tasks 1.1–1.2, 2.1–2.3, 3.1, 4.1–4.2;
//    add-plan-requests-and-move-statement 1.1–1.2 as section 5) ──────────────
//
// The plan layer end to end: the store's plans table and ledger derivation,
// the kernel's plan solvency gate and settlement election (settler='plan'
// settles locally — no sub2api call), the console's ops-only management
// routes, the caller self-statement, the full issue → turn → exhaust →
// adjust → restore chain against a listening app, and the caller-initiated
// ops-adjudicated plan-request queue.
//
//   node --test scripts/test-wanxing-plans.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { test } from "node:test";

const tmp = mkdtempSync(path.join(tmpdir(), "wx-plans-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore } = await import("../services/wanxing-facade/core.js");
const { createA2aFace } = await import("../services/wanxing-facade/a2a.js");
const { registerConsoleRoutes } = await import("../services/wanxing-facade/console.js");

const OPS_TOKEN = "ops-secret";

function stubSub2api({ userId = 7, email = "caller@finddata.tech", others = [] } = {}) {
  return {
    userId,
    email,
    others, // extra { userId, email } accounts the email lookup also knows
    adjustCalls: [],
    mirrorCalls: [],
    // mirrorBehaviour decides how the D6 mirror answers: "ok" (default) |
    // "reject" | "throw". The settlement outcome must not depend on it.
    mirrorBehaviour: "ok",
    degraded: () => false,
    async probeKeyLiveness() {
      return { ok: true };
    },
    async findUserByKey() {
      return { userId: this.userId, email: this.email };
    },
    async findUserByEmail(mail) {
      if (mail === this.email) return { userId: this.userId, email: this.email };
      return this.others.find((o) => o.email === mail) ?? null;
    },
    async adjustBalance(args) {
      this.adjustCalls.push(args);
      return { ok: true };
    },
    async mirrorUsage(args) {
      this.mirrorCalls.push(args);
      if (this.mirrorBehaviour === "throw") throw new Error("mirror exploded synchronously");
      if (this.mirrorBehaviour === "reject") return Promise.reject(new Error("mirror rejected"));
      return { ok: true, usage_id: 1, duplicate: false };
    },
  };
}

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

function coreHarness({ sub = stubSub2api(), store = freshStore() } = {}) {
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 100 } });
  const caller = { userId: sub.userId, email: sub.email };
  return { core, store, sub, caller };
}

// The listening app: the A2A face + the console routes on one express
// instance, wired like production (index.js shape). `identities` maps id
// tokens to the verified email they resolve to (default: one caller).
function appHarness({ sub = stubSub2api(), store = freshStore(), identities = null } = {}) {
  const idents = identities ?? { "good-id-token": sub.email };
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 100 } });
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-heal" ? { agentPath: "/packs/p1/heal" } : null),
    listDeployments: () => [{ slug: "packs-p1-heal", agentPath: "/packs/p1/heal" }],
    forwardHeaders: () => ({}),
    registryFetch: async () => new Response(JSON.stringify({
      name: "SpiderHeal", description: "repairs spiders", version: "3", visibility: "public", metadata: {},
    }), { headers: { "Content-Type": "application/json" } }),
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: { parts: [{ kind: "text", text: "ok" }] } } }), { headers: { "Content-Type": "application/json" } }),
  });
  const app = express();
  face.register(app);
  registerConsoleRoutes(app, {
    requireToken: (req) => String(req.headers["x-ops-token"] || "") === OPS_TOKEN,
    logtoAuth: {
      configured: true,
      verifyIdToken: async (token) => (idents[token] ? { email: idents[token] } : null),
    },
    bookkeeping: { rows: async () => [], resolve: async () => null },
    store,
    sub2api: sub,
    registryFetch: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
  });
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    core, store, sub, base,
    close: () => new Promise((r) => server.close(r)),
    call: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    send: (key, extra = {}) => fetch(base + "/api/wanxing/v1/a2a/packs-p1-heal", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...(extra.headers ?? {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "hello" }] } } }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
  };
}

// ── 1.1 store: table lifecycle, migration idempotency ────────────────────────

test("1.1 plans store opens twice on the same file (idempotent migrations)", () => {
  const file = path.join(mkdtempSync(path.join(tmp, "m-")), "wanxing.db");
  const a = createWanxingStore({ file });
  a.planSet(7, 100, "ops");
  a.close();
  const b = createWanxingStore({ file });
  assert.equal(b.planGet(7).limitMinutes, 100);
  b.close();
});

test("1.1 plan upsert keeps a stable plan_ref across cap rewrites", () => {
  const s = freshStore();
  const first = s.planSet(7, 60, "ops", "seed");
  const second = s.planSet(7, 120, "ops", "top-up");
  assert.equal(second.planRef, first.planRef);
  assert.equal(second.limitMinutes, 120);
  assert.equal(s.planGet(8), null);
});

// ── 1.2 remaining derives from the ledger ────────────────────────────────────

test("1.2 remaining = cap − plan-settled minutes; over-consumption clamps at zero; adjust is immediate", () => {
  const { core, store, caller } = coreHarness();
  store.planSet(caller.userId, 10, "ops");
  assert.equal(core.planStateFor(caller.userId).remaining, 10); // zero consumption = cap
  core.recordUsage({ caller, slug: "a", startedAt: 0, endedAt: 65_000, outcome: "ok" }); // 2 min
  core.recordUsage({ caller, slug: "a", startedAt: 0, endedAt: 10_000, outcome: "ok" }); // 1 min
  assert.equal(store.planUsed(caller.userId), 3);
  assert.equal(core.planStateFor(caller.userId).remaining, 7);
  store.planSet(caller.userId, 2, "ops"); // cap below usage → exhausted
  assert.equal(core.planStateFor(caller.userId).remaining, 0);
  store.planSet(caller.userId, 50, "ops"); // adjust up → immediately solvent
  assert.equal(core.planStateFor(caller.userId).remaining, 47);
  // planList carries the same derivation
  const [row] = store.planList();
  assert.equal(row.remainingMinutes, 47);
  assert.equal(row.usedMinutes, 3);
});

// ── 2.1 plan solvency gate ───────────────────────────────────────────────────

test("2.1 checkPlan: planless ok; solvent ok with remaining; exhausted → 402 PLAN_EXHAUSTED", () => {
  const { core, store, caller } = coreHarness();
  assert.equal(core.checkPlan(caller).ok, true); // no plan → untouched
  store.planSet(caller.userId, 5, "ops");
  const okGate = core.checkPlan(caller);
  assert.equal(okGate.ok, true);
  assert.equal(okGate.plan.remainingMinutes, 5);
  core.recordUsage({ caller, slug: "a", startedAt: 0, endedAt: 5 * 60_000, outcome: "ok" }); // 5 min
  const bad = core.checkPlan(caller);
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 402);
  assert.equal(bad.code, "PLAN_EXHAUSTED");
});

// ── 2.2 settlement election ──────────────────────────────────────────────────

test("2.2 a plan caller's turn elects settler=plan and settles locally — no sub2api call", async () => {
  const { core, store, sub, caller } = coreHarness();
  const plan = store.planSet(caller.userId, 60, "ops");
  const row = core.recordUsage({ caller, slug: "a", startedAt: 0, endedAt: 30_000, outcome: "ok" });
  assert.equal(row.settler, "plan");
  assert.equal(row.planRef, plan.planRef);
  const settled = await core.trySettle(row);
  assert.equal(settled, true);
  assert.equal(sub.adjustCalls.length, 0); // the plan path never touches the billing plane
  // Re-settling (inline + sweep race) is a no-op, and never a double draw.
  assert.equal(await core.trySettle(row), true);
  assert.equal(store.planUsed(caller.userId), 1);
});

test("2.2 a planless caller keeps the legacy key-balance path", async () => {
  const { core, store, sub, caller } = coreHarness();
  const row = core.recordUsage({ caller, slug: "a", startedAt: 0, endedAt: 30_000, outcome: "ok" });
  assert.equal(row.settler ?? null, null);
  assert.equal(row.planRef ?? null, null);
  await core.trySettle(row);
  assert.equal(sub.adjustCalls.length, 1);
  assert.equal(sub.adjustCalls[0].operation, "subtract");
});

// ── 2.2b D6 usage mirror: visible on the caller's panel, never load-bearing ─

test("D6 a plan settlement mirrors one display-only usage row", async () => {
  const { core, store, sub, caller } = coreHarness();
  const plan = store.planSet(caller.userId, 60, "ops");
  const row = core.recordUsage({ caller, slug: "packs-p1-heal", startedAt: 0, endedAt: 30_000, outcome: "ok" });
  assert.equal(await core.trySettle(row), true);
  await Promise.resolve(); // let the fire-and-forget land

  assert.equal(sub.mirrorCalls.length, 1);
  const mirror = sub.mirrorCalls[0];
  assert.equal(mirror.externalId, row.id); // the wu_ row id IS the idempotency key
  assert.equal(mirror.userId, caller.userId);
  assert.equal(mirror.minutes, row.minutesBilled);
  assert.equal(mirror.recordedAt, row.endedAt);
  assert.ok(mirror.note.includes(plan.planRef), `note should name the plan: ${mirror.note}`);
  assert.ok(mirror.note.includes("packs-p1-heal"), `note should name the agent: ${mirror.note}`);
  // Still display-only: nothing moved on the billing plane.
  assert.equal(sub.adjustCalls.length, 0);
});

for (const behaviour of ["reject", "throw"]) {
  test(`D6 a mirror that fails (${behaviour}) cannot change the settlement`, async () => {
    const sub = stubSub2api();
    sub.mirrorBehaviour = behaviour;
    const { core, store, caller } = coreHarness({ sub });
    store.planSet(caller.userId, 60, "ops");
    const row = core.recordUsage({ caller, slug: "a", startedAt: 0, endedAt: 30_000, outcome: "ok" });

    // The whole point: settlement stays green even though the mirror blew up.
    assert.equal(await core.trySettle(row), true);
    await new Promise((r) => setTimeout(r, 0)); // surface any unhandled rejection
    assert.equal(store.planUsed(caller.userId), 1);
    assert.equal(sub.mirrorCalls.length, 1); // it was attempted, just not retried
  });
}

test("D6 non-plan settlers are never mirrored", async () => {
  const { core, sub, caller } = coreHarness();
  // mission rows settle locally too, but they are not plan drawdowns.
  const missionRow = core.recordUsage({
    caller,
    slug: "a",
    startedAt: 0,
    endedAt: 30_000,
    outcome: "ok",
    settler: "mission",
  });
  await core.trySettle(missionRow);
  // legacy key-balance rows charge the caller's own balance instead.
  const legacyRow = core.recordUsage({ caller, slug: "a", startedAt: 0, endedAt: 30_000, outcome: "ok" });
  await core.trySettle(legacyRow);
  await Promise.resolve();

  assert.equal(sub.mirrorCalls.length, 0);
  assert.equal(sub.adjustCalls.length, 1); // the legacy path still charged
});

// ── 2.3 chat-lane rows are never re-elected ──────────────────────────────────

test("2.3 a chat-lane row keeps its resolved settler even when the visitor's id has a plan", () => {
  const { core, store } = coreHarness();
  // visitorCallerId shape (hashed 48-bit) — give THAT caller a plan, then
  // record a chat row: the explicit channel/settler must win, not the plan.
  const visitorId = 123456789012;
  store.planSet(visitorId, 60, "ops");
  const row = core.recordUsage({
    caller: { userId: visitorId, email: "visitor@x" },
    slug: "a", startedAt: 0, endedAt: 10_000, outcome: "ok",
    channel: "chat", settler: "host", visitorSub: "sub-x",
  });
  assert.equal(row.settler, "host");
  assert.equal(row.planRef ?? null, null);
  assert.equal(store.planUsed(visitorId), 0);
});

// ── 3.1 console management: ops-only ─────────────────────────────────────────

test("3.1 plans routes: ops token issues and lists; a verified identity is refused", async () => {
  const h = appHarness();
  const put = (body, headers) => h.call("/api/wanxing/v1/console/plans", {
    method: "PUT", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  // Identity (even the console-allowlisted caller themself) is refused.
  const denied = await put({ email: h.sub.email, limitMinutes: 30 }, { Authorization: "Bearer good-id-token" });
  assert.equal(denied.status, 403);
  // Ops issues; the audit row carries updatedBy=ops and the derived remaining.
  const issued = await put({ email: h.sub.email, limitMinutes: 30, note: "seed" }, { "x-ops-token": OPS_TOKEN });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.plan.limitMinutes, 30);
  assert.equal(issued.body.plan.updatedBy, "ops");
  assert.equal(issued.body.plan.remainingMinutes, 30);
  const list = await h.call("/api/wanxing/v1/console/plans", { headers: { "x-ops-token": OPS_TOKEN } });
  assert.equal(list.body.plans.length, 1);
  assert.equal(list.body.plans[0].remainingMinutes, 30);
  // Unknown account → the allowlist-shaped 404.
  const nope = await put({ email: "nobody@x", limitMinutes: 5 }, { "x-ops-token": OPS_TOKEN });
  assert.equal(nope.status, 404);
  assert.equal(nope.body.code, "NO_SUB2API_ACCOUNT");
  await h.close();
});

// ── 4.1 caller self-statement ────────────────────────────────────────────────

test("4.1 my/statement: own identity reads plan + dual usage; ops token redirected", async () => {
  const h = appHarness();
  h.store.planSet(h.sub.userId, 25, "ops");
  h.core.recordUsage({ caller: { userId: h.sub.userId, email: h.sub.email }, slug: "a", startedAt: 0, endedAt: 90_000, outcome: "ok" }); // plan 2 min
  const mine = await h.call("/api/wanxing/v1/console/my/statement", { headers: { Authorization: "Bearer good-id-token" } });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.email, h.sub.email);
  assert.equal(mine.body.plan.remainingMinutes, 23);
  assert.equal(mine.body.usage.planMinutes, 2);
  assert.equal(mine.body.usage.legacyMinutes, 0);
  // The ops token has no identity on this surface.
  const ops = await h.call("/api/wanxing/v1/console/my/statement", { headers: { "x-ops-token": OPS_TOKEN } });
  assert.equal(ops.status, 403);
  await h.close();
});

// ── 4.2 the full chain: issue → turn draws the plan → exhausted refusal → adjust restores ──

test("4.2 issue → turn → exhaust → PLAN_EXHAUSTED at the door → adjust → admitted again", async () => {
  const h = appHarness();
  const key = "sk-live-plan-key";
  const issue = (limit) => h.call("/api/wanxing/v1/console/plans", {
    method: "PUT", headers: { "Content-Type": "application/json", "x-ops-token": OPS_TOKEN },
    body: JSON.stringify({ email: h.sub.email, limitMinutes: limit }),
  });
  await issue(1);
  // Turn 1 passes and bills 1 minute against the plan (no balance deduction).
  const t1 = await h.send(key);
  assert.equal(t1.status, 200);
  assert.equal(h.sub.adjustCalls.length, 0);
  assert.equal(h.store.planUsed(h.sub.userId), 1);
  // Turn 2 hits the exhausted plan at the door.
  const t2 = await h.send(key);
  assert.equal(t2.status, 402);
  assert.equal(t2.body.error.code, "PLAN_EXHAUSTED");
  // Adjusting the cap restores admission with no manual unsuspend.
  await issue(10);
  const t3 = await h.send(key);
  assert.equal(t3.status, 200);
  assert.equal(h.store.planUsed(h.sub.userId), 2);
  await h.close();
});

// ── 5. plan requests (add-plan-requests-and-move-statement 1.1–1.2) ──────────
//
// The caller-initiated, ops-adjudicated queue: the store's own lifecycle
// (pending-first listing, decide only from pending), the self-service POST
// with its range gate, the two-perspective GET (identity = own rows only,
// ops = everyone), and the ops-only PUT where approval issues the plan
// through planSet BEFORE stamping the request, and rejection issues nothing.

const json = (method, body, headers) => ({ method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const REQ_PATH = "/api/wanxing/v1/console/plan-requests";

test("5.1 plan-request store: add/get, list pending-first newest-first, self-scope, decide only from pending", () => {
  const s = freshStore();
  const a = s.planRequestAdd(7, "Caller@Finddata.tech", 500, "first");
  assert.match(a.ref, /^wpr_[0-9a-f]{12}$/);
  assert.equal(a.status, "pending");
  assert.equal(a.email, "caller@finddata.tech"); // stored lowercased: the scoping key
  assert.equal(a.limitMinutes, 500);
  assert.equal(a.note, "first");
  assert.equal(a.decidedAt, null);
  const b = s.planRequestAdd(7, "caller@finddata.tech", 2000, "second");
  const c = s.planRequestAdd(8, "other@finddata.tech", 100, "");
  assert.equal(s.planRequestDecide(a.ref, "approved", "ops", "ok").status, "approved");
  // pending (newest first) above decided
  assert.deepEqual(s.planRequestList().map((r) => r.ref), [c.ref, b.ref, a.ref]);
  assert.deepEqual(s.planRequestList({ email: "caller@finddata.tech" }).map((r) => r.ref), [b.ref, a.ref]);
  // a decided row is final
  assert.equal(s.planRequestDecide(a.ref, "rejected", "ops", "again"), null);
  const got = s.planRequestGet(a.ref);
  assert.equal(got.status, "approved");
  assert.equal(got.decidedBy, "ops");
  assert.equal(got.decidedNote, "ok");
  assert.ok(got.decidedAt > 0);
  assert.throws(() => s.planRequestDecide(b.ref, "bogus", "ops"));
  assert.equal(s.planRequestGet("wpr_nope"), null);
  s.close();
});

test("5.2 POST/GET: identity submits for itself (range-gated) and lists only its own; ops lists all pending-first", async () => {
  const sub = stubSub2api({ others: [{ userId: 9, email: "peer@finddata.tech" }] });
  const h = appHarness({
    sub,
    identities: { "good-id-token": sub.email, "peer-id-token": "peer@finddata.tech", "stranger-id-token": "stranger@finddata.tech" },
  });
  const ME = { Authorization: "Bearer good-id-token" };
  const PEER = { Authorization: "Bearer peer-id-token" };
  const OPS = { "x-ops-token": OPS_TOKEN };
  const post = (body, headers) => h.call(REQ_PATH, json("POST", body, headers));
  // The ops token has no identity to request for.
  assert.equal((await post({ limitMinutes: 500 }, OPS)).status, 403);
  // Range + shape gate.
  assert.equal((await post({ limitMinutes: 59 }, ME)).status, 400);
  assert.equal((await post({ limitMinutes: 1_000_001 }, ME)).status, 400);
  assert.equal((await post({ limitMinutes: 500.5 }, ME)).status, 400);
  assert.equal((await post({ limitMinutes: "abc" }, ME)).status, 400);
  // An identity without a sub2api account gets the allowlist-shaped 404.
  const stranger = await post({ limitMinutes: 500 }, { Authorization: "Bearer stranger-id-token" });
  assert.equal(stranger.status, 404);
  assert.equal(stranger.body.code, "NO_SUB2API_ACCOUNT");
  // Submit: note trimmed; the row is pending and bound to the identity.
  const r1 = await post({ limitMinutes: 5000, note: "  for the Q4 pipeline  " }, ME);
  assert.equal(r1.status, 200);
  assert.equal(r1.body.request.status, "pending");
  assert.equal(r1.body.request.limitMinutes, 5000);
  assert.equal(r1.body.request.note, "for the Q4 pipeline");
  assert.equal(r1.body.request.email, sub.email);
  assert.equal(r1.body.request.userId, sub.userId);
  // A pending request does not block another (the queue is not a slot).
  const r2 = await post({ limitMinutes: 500 }, ME);
  assert.equal(r2.status, 200);
  const p1 = await post({ limitMinutes: 2000, note: "peer" }, PEER);
  assert.equal(p1.status, 200);
  // Identity perspective: own rows only, never the peer's.
  const mine = await h.call(REQ_PATH, { headers: ME });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.requests.map((r) => r.ref), [r2.body.request.ref, r1.body.request.ref]);
  assert.equal(mine.body.pending, 2);
  const peers = await h.call(REQ_PATH, { headers: PEER });
  assert.deepEqual(peers.body.requests.map((r) => r.ref), [p1.body.request.ref]);
  // Ops perspective: everyone, pending counted.
  const all = await h.call(REQ_PATH, { headers: OPS });
  assert.equal(all.body.requests.length, 3);
  assert.equal(all.body.pending, 3);
  await h.close();
});

test("5.3 PUT approve: ops-only; issues the plan via planSet (stamped ops) then marks approved; decided is final", async () => {
  const h = appHarness();
  const ME = { Authorization: "Bearer good-id-token" };
  const OPS = { "x-ops-token": OPS_TOKEN };
  const submitted = await h.call(REQ_PATH, json("POST", { limitMinutes: 5000, note: "please" }, ME));
  const ref = submitted.body.request.ref;
  assert.equal(h.store.planGet(h.sub.userId), null); // the request alone grants nothing
  const decide = (r, status, note, headers) => h.call(`${REQ_PATH}/${r}`, json("PUT", { status, note }, headers));
  // A non-ops identity — even the requester — cannot adjudicate; nothing moves.
  const denied = await decide(ref, "approved", "", ME);
  assert.equal(denied.status, 403);
  assert.equal(h.store.planRequestGet(ref).status, "pending");
  assert.equal(h.store.planGet(h.sub.userId), null);
  assert.equal((await decide(ref, "maybe", "", OPS)).status, 400);
  assert.equal((await decide("wpr_nope", "approved", "", OPS)).status, 404);
  // Approve: plan lands through the issuance path, request reads approved.
  const approved = await decide(ref, "approved", "welcome", OPS);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.request.status, "approved");
  assert.equal(approved.body.request.decidedBy, "ops");
  assert.equal(approved.body.request.decidedNote, "welcome");
  assert.ok(approved.body.request.decidedAt > 0);
  assert.equal(approved.body.plan.limitMinutes, 5000);
  assert.equal(approved.body.plan.updatedBy, "ops");
  assert.equal(approved.body.plan.remainingMinutes, 5000);
  const plan = h.store.planGet(h.sub.userId);
  assert.equal(plan.limitMinutes, 5000);
  assert.equal(plan.updatedBy, "ops");
  assert.equal(plan.note, "welcome");
  assert.equal(plan.email, h.sub.email);
  // The caller's statement now carries it.
  const mine = await h.call("/api/wanxing/v1/console/my/statement", { headers: ME });
  assert.equal(mine.body.plan.limitMinutes, 5000);
  // A decided request is final (409); the plan is untouched.
  assert.equal((await decide(ref, "rejected", "nope", OPS)).status, 409);
  assert.equal(h.store.planGet(h.sub.userId).limitMinutes, 5000);
  assert.equal(h.store.planRequestGet(ref).status, "approved");
  // A later request approved ADJUSTS the same plan (stable plan_ref); with no
  // decision note the plan's note points back at the request.
  const s2 = await h.call(REQ_PATH, json("POST", { limitMinutes: 10000 }, ME));
  const a2 = await decide(s2.body.request.ref, "approved", "", OPS);
  assert.equal(a2.status, 200);
  assert.equal(a2.body.plan.planRef, plan.planRef);
  assert.equal(a2.body.plan.limitMinutes, 10000);
  assert.equal(h.store.planGet(h.sub.userId).note, `申请 ${s2.body.request.ref}`);
  assert.equal((await h.call("/api/wanxing/v1/console/plans", { headers: OPS })).body.plans.length, 1);
  await h.close();
});

test("5.4 PUT reject: records the note, issues nothing, existing plan untouched; the queue drops it from pending", async () => {
  const h = appHarness();
  const ME = { Authorization: "Bearer good-id-token" };
  const OPS = { "x-ops-token": OPS_TOKEN };
  h.store.planSet(h.sub.userId, 30, "ops", "existing");
  const submitted = await h.call(REQ_PATH, json("POST", { limitMinutes: 90000 }, ME));
  const ref = submitted.body.request.ref;
  const rejected = await h.call(`${REQ_PATH}/${ref}`, json("PUT", { status: "rejected", note: "too much" }, OPS));
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.request.status, "rejected");
  assert.equal(rejected.body.request.decidedNote, "too much");
  assert.equal(rejected.body.request.decidedBy, "ops");
  assert.equal(rejected.body.plan, null);
  const plan = h.store.planGet(h.sub.userId);
  assert.equal(plan.limitMinutes, 30);
  assert.equal(plan.note, "existing");
  // The caller reads the verdict; the ops queue has nothing pending.
  const mine = await h.call(REQ_PATH, { headers: ME });
  assert.equal(mine.body.requests[0].status, "rejected");
  assert.equal(mine.body.requests[0].decidedNote, "too much");
  const queue = await h.call(REQ_PATH, { headers: OPS });
  assert.equal(queue.body.pending, 0);
  assert.equal(queue.body.requests.length, 1);
  await h.close();
});
