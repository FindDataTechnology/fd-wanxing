#!/usr/bin/env node
// ── Serving-plan tests (add-serving-plans tasks 1.1–1.2, 2.1–2.3, 3.1, 4.1–4.2) ─
//
// The plan layer end to end: the store's plans table and ledger derivation,
// the kernel's plan solvency gate and settlement election (settler='plan'
// settles locally — no sub2api call), the console's ops-only management
// routes, the caller self-statement, and the full issue → turn → exhaust →
// adjust → restore chain against a listening app.
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

function stubSub2api({ userId = 7, email = "caller@finddata.tech" } = {}) {
  return {
    userId,
    email,
    adjustCalls: [],
    degraded: () => false,
    async probeKeyLiveness() {
      return { ok: true };
    },
    async findUserByKey() {
      return { userId: this.userId, email: this.email };
    },
    async findUserByEmail(mail) {
      return mail === this.email ? { userId: this.userId, email: this.email } : null;
    },
    async adjustBalance(args) {
      this.adjustCalls.push(args);
      return { ok: true };
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
// instance, wired like production (index.js shape).
function appHarness({ sub = stubSub2api(), store = freshStore() } = {}) {
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
      verifyIdToken: async (token) => (token === "good-id-token" ? { email: sub.email } : null),
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
