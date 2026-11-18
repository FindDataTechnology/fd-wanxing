#!/usr/bin/env node
// ── Line copilot bindings + public resolution (unify-cross-line-copilot 1.1–1.5)
//
// The Wanxing plane's own governance record for "which public deployment is a
// line's OUTWARD copilot": the store roundtrip, the ops-only console face (slug
// validation against the bookkeeping snapshot, public-only), the public
// cross-origin resolution (four states, CORS, secret-free projection), and the
// intent-vs-effect split that keeps the anonymous double gate intact.
//
//   node --test scripts/test-wanxing-line-copilot.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import http from "node:http";
import { test } from "node:test";

const { createWanxingStore } = await import("../services/wanxing-facade/store.js");
const { createWanxingCore } = await import("../services/wanxing-facade/core.js");
const { createA2aFace } = await import("../services/wanxing-facade/a2a.js");
const { createChatFace } = await import("../services/wanxing-facade/chat.js");
const { registerConsoleRoutes } = await import("../services/wanxing-facade/console.js");

const tmp = mkdtempSync(path.join(tmpdir(), "wx-line-copilot-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const OPS_TOKEN = "ops-test-token";
const SECRET = "unit-embed-secret";
const SLUG = "packs-p1-chat";

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

// ── 1.1 store roundtrip ─────────────────────────────────────────────────────

test("1.1 store: line bindings roundtrip, upsert in place, delete is idempotent", () => {
  const s = freshStore();
  assert.equal(s.lineCopilotGet("lex"), null);
  assert.deepEqual(s.lineCopilotList(), []);

  const created = s.lineCopilotSet("lex", { agentSlug: SLUG, accent: "#1d4ed8", anonymousIntent: true, updatedBy: "ops" });
  assert.deepEqual(created, {
    line: "lex", agentSlug: SLUG, accent: "#1d4ed8", anonymousIntent: true, updatedBy: "ops", updatedAt: created.updatedAt,
  });
  assert.equal(s.lineCopilotGet("lex").agentSlug, SLUG);
  assert.equal(s.lineCopilotList().length, 1);

  const rewritten = s.lineCopilotSet("lex", { agentSlug: "packs-p2-other", accent: "", anonymousIntent: false, updatedBy: "ops" });
  assert.equal(rewritten.agentSlug, "packs-p2-other");
  assert.equal(rewritten.anonymousIntent, false);
  assert.equal(s.lineCopilotList().length, 1, "the line is the primary key — an upsert never duplicates");

  s.lineCopilotSet("wire", { agentSlug: SLUG, updatedBy: "ops" });
  assert.deepEqual(s.lineCopilotList().map((b) => b.line), ["lex", "wire"]);

  assert.equal(s.lineCopilotDelete("lex"), true);
  assert.equal(s.lineCopilotDelete("lex"), false);
  assert.equal(s.lineCopilotGet("lex"), null);
});

// ── Harness: a2a + chat faces + console face over one store ─────────────────

function harness({ store = freshStore(), paused = false, visibility = "public", env = {} } = {}) {
  const sub = {
    userId: 7,
    degraded: () => false,
    async findUserByKey() { return { userId: 7, email: "subsidy@finddata.tech" }; },
    async adjustBalance() { return { ok: true }; },
  };
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const entry = {
    name: "Line Copilot", description: "the line's assistant", version: "1",
    visibility, capabilities: { streaming: true }, skills: [], tags: [], metadata: paused ? { paused: true } : {},
  };
  const registryFetch = async () => new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } });
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === SLUG ? { agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent" } : null),
    listDeployments: () => [{ slug: SLUG, agentPath: "/packs/p1/chat" }],
    forwardHeaders: () => ({}),
    registryFetch,
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
  });
  const chatFace = createChatFace({
    core,
    store,
    agentState: (slug) => face.agentState(slug),
    resolveDeployment: async (slug) => (slug === SLUG ? { packId: "p1", agentId: "chat-agent", agentPath: "/packs/p1/chat" } : null),
    forwardHeaders: () => ({}),
    sub2api: sub,
    subsidyKey: "sk-platform",
    subsidyUserId: 7,
    chat: { rpmMax: 100, subsidyEnabled: true, subsidyDailyMinutes: 10, embed: { anonEnabled: false, embedSecret: SECRET } },
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
  });

  const app = express();
  face.register(app);
  chatFace.register(app);
  registerConsoleRoutes(app, {
    requireToken: (req) => req.headers.authorization === `Bearer ${OPS_TOKEN}`,
    logtoAuth: {
      configured: true,
      async verifyIdToken(token) {
        return token === "tok-deployer" ? { email: "deployer@finddata.tech", sub: "sub-deployer" } : null;
      },
    },
    bookkeeping: {
      rows: async () => [{ agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent", version: "1", deployedBy: "deployer@finddata.tech" }],
      resolve: async (slug) => (slug === SLUG ? { agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent", version: "1", deployedBy: "deployer@finddata.tech" } : null),
      hardStale: () => 0,
      poke: () => {},
    },
    store,
    sub2api: sub,
    registryFetch,
    resolveLineState: (line) => chatFace.lineState(line),
    env,
    log: () => {},
  });

  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store, chatFace, base,
    call: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) })),
    ops: (p, init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${OPS_TOKEN}` } }),
    close: () => new Promise((r) => server.close(r)),
  };
}

const bind = (h, line, body) =>
  h.call(`/api/wanxing/v1/console/line-copilots/${line}`, h.ops(line, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

const resolveLine = (h, line) => h.call(`/api/wanxing/v1/lines/${line}/copilot`);

// ── 1.2 console face: ops-only, validated, public-only ──────────────────────

test("1.2 console: ops-only write, line/slug validation, public-only, delete", async () => {
  const h = harness();
  try {
    // A verified console identity (deployer) is refused — bindings are ops policy.
    const byIdentity = await h.call("/api/wanxing/v1/console/line-copilots/lex", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok-deployer" },
      body: JSON.stringify({ agentSlug: SLUG }),
    });
    assert.equal(byIdentity.status, 403);

    // Bad line id, missing slug, unknown deployment, bad accent.
    assert.equal((await bind(h, "BAD LINE", { agentSlug: SLUG })).status, 400);
    assert.equal((await bind(h, "lex", {})).status, 400);
    assert.equal((await bind(h, "lex", { agentSlug: "packs-nope" })).status, 404);
    assert.equal((await bind(h, "lex", { agentSlug: SLUG, accent: "red" })).status, 400);

    const ok = await bind(h, "lex", { agentSlug: SLUG, accent: "#1d4ed8" });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.binding.agentSlug, SLUG);
    assert.equal(ok.body.binding.updatedBy, "ops");

    const list = await h.call("/api/wanxing/v1/console/line-copilots", h.ops("/api/wanxing/v1/console/line-copilots"));
    assert.equal(list.status, 200);
    assert.equal(list.body.bindings.length, 1);
    assert.equal(list.body.bindings[0].line, "lex");
    assert.equal(list.body.bindings[0].state, "ready");
    assert.equal(list.body.bindings[0].agentName, "Line Copilot");

    const del = await h.call("/api/wanxing/v1/console/line-copilots/lex", h.ops("/api/wanxing/v1/console/line-copilots/lex", { method: "DELETE" }));
    assert.equal(del.status, 200);
    assert.equal((await h.call("/api/wanxing/v1/console/line-copilots/lex", h.ops("/api/wanxing/v1/console/line-copilots/lex", { method: "DELETE" }))).status, 404);
    assert.deepEqual(h.store.lineCopilotList(), []);
  } finally {
    await h.close();
  }
});

test("1.2 console: a private deployment cannot be a line's outward copilot", async () => {
  const h = harness({ visibility: "private" });
  try {
    const r = await bind(h, "lex", { agentSlug: SLUG });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, "AGENT_NOT_PUBLIC");
    assert.deepEqual(h.store.lineCopilotList(), []);
  } finally {
    await h.close();
  }
});

// ── 1.3 public resolution: four states, CORS, secret-free ───────────────────

test("1.3 public: unbound / unknown / ready states, CORS wildcard, no internals", async () => {
  const h = harness();
  try {
    const unbound = await resolveLine(h, "lex");
    assert.equal(unbound.status, 200);
    assert.equal(unbound.body.state, "unbound");
    assert.equal(unbound.headers.get("access-control-allow-origin"), "*");
    assert.equal(unbound.headers.get("access-control-allow-credentials"), null);
    assert.match(unbound.headers.get("cache-control") ?? "", /max-age=60/);

    const unknown = await resolveLine(h, "NOT_A_LINE");
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.state, "unknown");

    await bind(h, "lex", { agentSlug: SLUG, accent: "#1d4ed8" });
    const ready = await resolveLine(h, "lex");
    assert.equal(ready.body.state, "ready");
    assert.equal(ready.body.agent.slug, SLUG);
    assert.equal(ready.body.agent.name, "Line Copilot");
    assert.equal(ready.body.theme.accent, "#1d4ed8");
    assert.equal(ready.body.features.asks, true);
    // The anonymous gates are off in this harness: a logged-in visitor can
    // still be served, so the effective tier is login_required, not closed.
    assert.equal(ready.body.anonymous, "login_required");

    // Projection must never leak settlement/quota/deployer internals.
    const text = JSON.stringify(ready.body);
    for (const forbidden of ["caller", "settler", "remaining", "quota", "email", "key", "updatedBy", "anonymousIntent"]) {
      assert.equal(text.includes(forbidden), false, `projection leaked "${forbidden}": ${text}`);
    }
  } finally {
    await h.close();
  }
});

test("1.3 public: a paused or vanished bound agent resolves closed with a reason", async () => {
  const pausedH = harness({ paused: true });
  try {
    await bind(pausedH, "lex", { agentSlug: SLUG });
    const r = await resolveLine(pausedH, "lex");
    assert.equal(r.body.state, "closed");
    assert.equal(r.body.reason, "agent_paused");
    assert.equal(r.body.agent, undefined, "a closed line offers no agent conversation");
  } finally {
    await pausedH.close();
  }

  const h = harness();
  try {
    // Bind, then make the deployment vanish from the bookkeeping snapshot.
    h.store.lineCopilotSet("lex", { agentSlug: SLUG, updatedBy: "ops" });
    h.store.lineCopilotSet("stale", { agentSlug: "packs-gone", updatedBy: "ops" });
    const r = await resolveLine(h, "stale");
    assert.equal(r.body.state, "closed");
    assert.equal(r.body.reason, "agent_missing");
  } finally {
    await h.close();
  }
});

// ── 1.4 intent vs effect: the anonymous double gate stays intact ────────────

test("1.4 intent/effect: a binding never opens anonymous by itself; the gap is visible", async () => {
  const h = harness();
  try {
    const r = await bind(h, "lex", { agentSlug: SLUG, anonymousIntent: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.binding.anonymousIntent, true);

    // Intent says anonymous, but the agent's own deployer switch is off → the
    // public face says login_required and the console flags the gap.
    const pub = await resolveLine(h, "lex");
    assert.equal(pub.body.anonymous, "login_required");

    const list = await h.call("/api/wanxing/v1/console/line-copilots", h.ops("/api/wanxing/v1/console/line-copilots"));
    assert.equal(list.body.bindings[0].effective, "login_required");
    assert.equal(list.body.bindings[0].gap, true);

    // Open the agent's deployer switch AND the platform switch: the intent
    // becomes effective, and the gap closes.
    h.store.embedSettingsSet(SLUG, { anonymous: true, origins: [], updatedBy: "deployer@finddata.tech" });
    const chatWithAnon = createChatFace; // (the harness closes over the gate config; assert through the public face)
    void chatWithAnon;

    // The harness's platform switch is off, so the deployer switch alone must
    // NOT open the lane — that is the double gate.
    const stillGated = await resolveLine(h, "lex");
    assert.equal(stillGated.body.anonymous, "login_required");
  } finally {
    await h.close();
  }
});

test("1.4 intent/effect: both gates open resolves anonymous open", async () => {
  const store = freshStore();
  const h = harness({ store });
  // Re-register a chat face with the platform anonymous switch on by patching
  // the harness: simplest honest route is a second harness variant.
  await h.close();

  const h2 = harnessWithAnonOpen(store);
  try {
    h2.store.lineCopilotSet("lex", { agentSlug: SLUG, anonymousIntent: true, updatedBy: "ops" });
    h2.store.embedSettingsSet(SLUG, { anonymous: true, origins: ["https://lex.example"], updatedBy: "deployer@finddata.tech" });
    const pub = await h2.call("/api/wanxing/v1/lines/lex/copilot");
    assert.equal(pub.body.state, "ready");
    assert.equal(pub.body.anonymous, "open");
    const list = await h2.call("/api/wanxing/v1/console/line-copilots", h2.ops("/api/wanxing/v1/console/line-copilots"));
    assert.equal(list.body.bindings[0].effective, "open");
    assert.equal(list.body.bindings[0].gap, false);
  } finally {
    await h2.close();
  }
});

// Variant harness: identical wiring with the platform anonymous switch ON.
function harnessWithAnonOpen(store, env = {}) {
  const sub = {
    userId: 7,
    degraded: () => false,
    async findUserByKey() { return { userId: 7, email: "subsidy@finddata.tech" }; },
    async adjustBalance() { return { ok: true }; },
  };
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const entry = { name: "Line Copilot", description: "the line's assistant", version: "1", visibility: "public", capabilities: { streaming: true }, skills: [], tags: [], metadata: {} };
  const registryFetch = async () => new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } });
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === SLUG ? { agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent" } : null),
    listDeployments: () => [{ slug: SLUG, agentPath: "/packs/p1/chat" }],
    forwardHeaders: () => ({}),
    registryFetch,
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
  });
  const chatFace = createChatFace({
    core,
    store,
    agentState: (slug) => face.agentState(slug),
    resolveDeployment: async (slug) => (slug === SLUG ? { packId: "p1", agentId: "chat-agent", agentPath: "/packs/p1/chat" } : null),
    forwardHeaders: () => ({}),
    sub2api: sub,
    subsidyKey: "sk-platform",
    subsidyUserId: 7,
    chat: { rpmMax: 100, subsidyEnabled: true, subsidyDailyMinutes: 10, embed: { anonEnabled: true, anonDailyMinutes: 3, embedSecret: SECRET, embedOrigins: ["https://lex.example"] } },
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }),
  });
  const app = express();
  face.register(app);
  chatFace.register(app);
  registerConsoleRoutes(app, {
    requireToken: (req) => req.headers.authorization === `Bearer ${OPS_TOKEN}`,
    logtoAuth: { configured: true, async verifyIdToken() { return null; } },
    bookkeeping: {
      rows: async () => [{ agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent", version: "1", deployedBy: "deployer@finddata.tech" }],
      resolve: async (slug) => (slug === SLUG ? { agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent", version: "1", deployedBy: "deployer@finddata.tech" } : null),
      hardStale: () => 0,
      poke: () => {},
    },
    store,
    sub2api: sub,
    registryFetch,
    resolveLineState: (line) => chatFace.lineState(line),
    env,
    log: () => {},
  });
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store, base,
    call: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) })),
    ops: (p, init = {}) => ({ ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${OPS_TOKEN}` } }),
    close: () => new Promise((r) => server.close(r)),
  };
}

// ── Line roster: 未绑定是显式缺口，孵化态是不同的判词 ────────────────────────
// 运营面此前只列**已有绑定**的行：未绑定的对外线根本不出现，于是「这条线还没有
// 副驾」和「这条线不需要副驾」在界面上是同一种沉默。名册把两类分开。

test("line roster: an unbound outward line is a visible gap; an incubating one is not", async () => {
  const h = harness({
    env: {
      WANXING_COPILOT_LINES: "lex,wire",
      WANXING_COPILOT_INCUBATING_LINES: "shilun,zhesi",
    },
  });
  try {
    const before = await h.call("/api/wanxing/v1/console/line-copilots", h.ops("/api/wanxing/v1/console/line-copilots"));
    assert.equal(before.status, 200, JSON.stringify(before.body));
    const rows = new Map(before.body.bindings.map((b) => [b.line, b]));

    // 名册里的对外线：没绑定 = 可见缺口
    for (const line of ["lex", "wire"]) {
      const row = rows.get(line);
      assert.ok(row, `${line} must appear as a gap, not vanish`);
      assert.equal(row.missing, true);
      assert.equal(row.notApplicable, false);
      assert.equal(row.state, "unbound");
    }
    // 孵化态：同样是 unbound，但判词不同
    for (const line of ["shilun", "zhesi"]) {
      const row = rows.get(line);
      assert.ok(row, `${line} must be listed so the operator can tell why it has no copilot`);
      assert.equal(row.notApplicable, true);
      assert.equal(row.missing, false);
    }

    // 绑上之后该行从缺口变成正常行
    await h.call("/api/wanxing/v1/console/line-copilots/lex", h.ops("/api/wanxing/v1/console/line-copilots/lex", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentSlug: SLUG }),
    }));
    const after = await h.call("/api/wanxing/v1/console/line-copilots", h.ops("/api/wanxing/v1/console/line-copilots"));
    const lexRows = after.body.bindings.filter((b) => b.line === "lex");
    assert.equal(lexRows.length, 1, "a bound line must not be duplicated by the roster");
    assert.equal(lexRows[0].state, "ready");
    assert.notEqual(lexRows[0].missing, true);
  } finally {
    await h.close();
  }
});

test("line roster: absent roster env changes nothing (byte-identical legacy shape)", async () => {
  const h = harness();
  try {
    const r = await h.call("/api/wanxing/v1/console/line-copilots", h.ops("/api/wanxing/v1/console/line-copilots"));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.bindings, []);
  } finally {
    await h.close();
  }
});
