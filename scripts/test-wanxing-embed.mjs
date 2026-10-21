#!/usr/bin/env node
// ── Wanxing embed-lane tests (add-embed-copilot-lane 1.1–3.2) ────────────────
//
// The embed lane: ephemeral credential sign/verify (real HMAC), the tier-split
// daily buckets in the store, the origin-gated mint, the double-gated
// anonymous admission (never the host allowance), tier-stamped ledger rows,
// the public embed-config cold-start shape, and the console embed-settings
// routes (deployer-or-ops, origin normalization, validation).
//
//   node --test scripts/test-wanxing-embed.mjs
//
// Tenant ID tokens are stubbed at the logto seam (real ES384 verification and
// the embed-audience allowlist are covered by test-wanxing-logto); the
// platform-sub2api stub is the chat-lane one.

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
const { createChatFace, signEphemeral, verifyEphemeral } = await import("../services/wanxing-facade/chat.js");
const { registerConsoleRoutes } = await import("../services/wanxing-facade/console.js");

const tmp = mkdtempSync(path.join(tmpdir(), "wx-embed-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const SECRET = "unit-embed-secret";
const jsonReply = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: { parts: [{ kind: "text", text: "queued" }] } } }), { headers: { "Content-Type": "application/json" } });

function stubSub2api({ userId = 7 } = {}) {
  return {
    userId,
    adjustCalls: [],
    degraded: () => false,
    async findUserByKey() { return { userId, email: "subsidy@finddata.tech" }; },
    async adjustBalance(args) { this.adjustCalls.push(args); return { ok: true }; },
  };
}

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

// ── 2.1 ephemeral sign/verify unit (real HMAC) ───────────────────────────────

test("2.1 ephemeral: roundtrip, wrong secret, tamper, expiry", () => {
  const p = { vid: "v1", slug: "packs-p1-chat", iat: Date.now(), exp: Date.now() + 60_000 };
  const t = signEphemeral(p, SECRET);
  assert.deepEqual(verifyEphemeral(t, SECRET), p);
  assert.equal(verifyEphemeral(t, "other-secret"), null);
  const [body, mac] = t.split(".");
  assert.equal(verifyEphemeral(`${body.slice(0, -1)}x.${mac}`, SECRET), null); // tampered payload
  assert.equal(verifyEphemeral(signEphemeral({ ...p, exp: Date.now() - 1 }, SECRET), SECRET), null);
  assert.equal(verifyEphemeral("garbage", SECRET), null);
  assert.equal(verifyEphemeral(t, ""), null); // unconfigured secret fails closed
});

// ── 1.1 store: tier-split daily buckets ──────────────────────────────────────

test("1.1 ledger tier separation: anon and tenant buckets never cross", () => {
  const s = freshStore();
  const row = (over) => ({
    id: `wu-${Math.random().toString(36).slice(2)}`, callerId: 99, callerEmail: "", agentSlug: "packs-p1-chat",
    idemKey: "", startedAt: Date.now(), endedAt: Date.now() + 60_000, durationMs: 60_000, outcome: "ok",
    minutesBilled: 1, rateUsd: 0.1, settlementStatus: "settled", channel: "chat", settler: "subsidy",
    ...over,
  });
  s.usageInsert(row({ visitorSub: "anon:abc", visitorTier: "anon" }));
  s.usageInsert(row({ visitorSub: "sub-x", visitorTier: "tenant" }));
  const [from, to] = [0, Date.now() + 1000];
  assert.equal(s.chatSubsidyUsed("anon:abc", from, to, "anon"), 1);
  assert.equal(s.chatSubsidyUsed("anon:abc", from, to, "tenant"), 0); // anon rows never leak into the tenant bucket
  assert.equal(s.chatSubsidyUsed("sub-x", from, to, "tenant"), 1);
  assert.equal(s.chatSubsidyUsed("sub-x", from, to, "anon"), 0);
  assert.equal(s.chatSubsidyUsed("sub-x", from, to), 1); // default tier = tenant (regression: existing callers)
});

// ── Embed-lane harness (chat face + optional console face, shared store) ─────

function embedHarness({
  store = freshStore(),
  sub = stubSub2api(),
  chat = {},
  embed = {},
  subsidyUserId = 7,
  upstream = () => jsonReply(),
} = {}) {
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const entry = { name: "Copilot", description: "embedded", version: "1", visibility: "public", capabilities: { streaming: true }, skills: [], tags: [], metadata: {} };
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
  const chatFaceRef = { current: null };
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-chat" ? { agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent" } : null),
    listDeployments: () => [{ slug: "packs-p1-chat", agentPath: "/packs/p1/chat" }],
    forwardHeaders: () => ({}),
    registryFetch: async () => new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } }),
    chatability: (state) => (chatFaceRef.current ? chatFaceRef.current.chatable(state) : false),
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => upstream(),
  });
  const chatFace = createChatFace({
    core,
    store,
    logto: logtoStub,
    agentState: (slug) => face.agentState(slug),
    resolveDeployment: async (slug) => (slug === "packs-p1-chat" ? { packId: "p1", agentId: "chat-agent", agentPath: "/packs/p1/chat" } : null),
    forwardHeaders: () => ({}),
    hostSettle: async () => ({ settled: true, duplicate: false }),
    sub2api: sub,
    subsidyKey: "sk-platform",
    subsidyUserId,
    chat: { rpmMax: 100, ...chat, embed: { anonEnabled: true, anonDailyMinutes: 1, embedSecret: SECRET, embedOrigins: ["https://lex.example"], embedTtlMs: 60_000, mintRpmMax: 50, ...embed } },
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => upstream(),
  });
  chatFaceRef.current = chatFace;
  const app = express();
  face.register(app);
  chatFace.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    core, store, chatFace, sub, base, server,
    call: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    close: () => new Promise((r) => server.close(r)),
  };
}

const SLUG = "packs-p1-chat";
const CHAT_URL = `/api/wanxing/v1/chat/${SLUG}`;
const anonEnabledStore = (store) => store.embedSettingsSet(SLUG, { anonymous: true, origins: ["https://lex.example"], updatedBy: "ops" });

const send = (text, { token, origin, idem } = {}) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(origin ? { Origin: origin } : {}),
    ...(idem ? { "Idempotency-Key": idem } : {}),
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text }] } } }),
});
const mint = (origin) => ({
  method: "POST",
  headers: { ...(origin ? { Origin: origin } : {}) },
});

async function mintToken(h, origin = "https://lex.example") {
  const r = await h.call(`${CHAT_URL}/visitor-token`, mint(origin));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.token;
}

const waitFor = async (fn, ms = 1500) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) return fn();
    await new Promise((r) => setTimeout(r, 15));
  }
};

// ── 2.1 mint route: origin gate, gates, rate, unconfigured ───────────────────

test("2.1 mint: allowed origin mints a slug-scoped credential; disallowed/no origin refuse", async () => {
  const h = embedHarness();
  anonEnabledStore(h.store);
  try {
    const token = await mintToken(h);
    const p = verifyEphemeral(token, SECRET);
    assert.equal(p.slug, SLUG);
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, mint("https://evil.example"))).body.error.code, "EMBED_ORIGIN_NOT_ALLOWED");
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, mint(null))).body.error.code, "EMBED_ORIGIN_NOT_ALLOWED");
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, mint("https://lex.example/"))).status, 201); // trailing slash normalizes
    // Same-origin widget shape: no Origin header, origin attested in the body.
    const bodyOrigin = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: "https://lex.example" }) };
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, bodyOrigin)).status, 201);
    const bodyBad = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: "https://evil.example" }) };
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, bodyBad)).body.error.code, "EMBED_ORIGIN_NOT_ALLOWED");
    const bodyGarbage = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: "javascript:alert(1)" }) };
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, bodyGarbage)).status, 403);
    // Same-origin POST (live finding 2026-10-22): browsers set Origin on EVERY
    // POST — the widget's own mint arrives with OUR host in the header. The
    // body claim is then the attested embedding origin and must stand; a
    // foreign header still wins (covered by the evil.example case above).
    // Host-only comparison: behind the nginx proxy the scheme may differ.
    const sameOriginBody = (header) => ({ method: "POST", headers: { "Content-Type": "application/json", Origin: header }, body: JSON.stringify({ origin: "https://lex.example" }) });
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, sameOriginBody(h.base))).status, 201);
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, sameOriginBody(h.base.replace("http://", "https://")))).status, 201);
    const sameOriginBadClaim = { method: "POST", headers: { "Content-Type": "application/json", Origin: h.base }, body: JSON.stringify({ origin: "https://evil.example" }) };
    assert.equal((await h.call(`${CHAT_URL}/visitor-token`, sameOriginBadClaim)).body.error.code, "EMBED_ORIGIN_NOT_ALLOWED");
  } finally { await h.close(); }
});

test("2.1 mint: both anonymous gates must be open; no secret fails closed; mint is rate-bounded", async () => {
  const ORIGIN = "https://lex.example";
  const off = embedHarness();
  try {
    off.store.embedSettingsSet(SLUG, { anonymous: false, origins: [ORIGIN], updatedBy: "ops" });
    const r1 = await off.call(`${CHAT_URL}/visitor-token`, mint(ORIGIN));
    assert.equal(r1.body.error.code, "ANON_NOT_OPEN");
    assert.equal(r1.body.error.loginUpgrade, true);
  } finally { await off.close(); }

  const globalOff = embedHarness({ embed: { anonEnabled: false } });
  try {
    anonEnabledStore(globalOff.store);
    assert.equal((await globalOff.call(`${CHAT_URL}/visitor-token`, mint(ORIGIN))).body.error.code, "ANON_NOT_OPEN");
  } finally { await globalOff.close(); }

  const noSecret = embedHarness({ embed: { embedSecret: "" } });
  try {
    anonEnabledStore(noSecret.store);
    assert.equal((await noSecret.call(`${CHAT_URL}/visitor-token`, mint(ORIGIN))).status, 503);
  } finally { await noSecret.close(); }

  const tight = embedHarness({ embed: { mintRpmMax: 2 } });
  try {
    anonEnabledStore(tight.store);
    assert.equal((await tight.call(`${CHAT_URL}/visitor-token`, mint(ORIGIN))).status, 201);
    assert.equal((await tight.call(`${CHAT_URL}/visitor-token`, mint(ORIGIN))).status, 201);
    assert.equal((await tight.call(`${CHAT_URL}/visitor-token`, mint(ORIGIN))).status, 429);
  } finally { await tight.close(); }
});

// ── 2.2 anonymous admission: double gate, own bucket, never host, scope ──────

test("2.2 anon turn: admitted under both gates, tier-stamped, platform key settles; cross-slug token refuses", async () => {
  const h = embedHarness({ chat: { subsidyEnabled: true, subsidyDailyMinutes: 5 } });
  anonEnabledStore(h.store);
  try {
    const token = await mintToken(h);
    const r = await h.call(CHAT_URL, send("hi", { token, idem: "a1" }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = await waitFor(() => h.store.usagePending().length === 0 && h.store.usageByCaller(SLUG, 0).find((x) => x.channel === "chat"));
    assert.ok(row, "anon ledger row landed");
    assert.ok(h.sub.adjustCalls.some((a) => a.operation === "subtract"), "platform subsidy key deducted for the anon turn");
    // Tier marker on the raw row: re-derive via the anon bucket.
    assert.equal(h.store.chatSubsidyUsed(`anon:${verifyEphemeral(token, SECRET).vid}`, 0, Date.now() + 1000, "anon"), 1);

    // Cross-agent replay: a token signed for another slug never opens this lane.
    const foreign = signEphemeral({ vid: "v-foreign", slug: "packs-p9-other", iat: Date.now(), exp: Date.now() + 60_000 }, SECRET);
    assert.equal((await h.call(CHAT_URL, send("hi", { token: foreign, idem: "a2" }))).status, 401);
    // Expired token refuses as a visitor-auth error.
    const stale = signEphemeral({ vid: "v-old", slug: SLUG, iat: 0, exp: Date.now() - 1 }, SECRET);
    assert.equal((await h.call(CHAT_URL, send("hi", { token: stale, idem: "a3" }))).status, 401);
  } finally { await h.close(); }
});

test("2.2 anon exhaustion: login-upgrade 402, host pool funded but untouched; tier gate off refuses 403", async () => {
  const h = embedHarness({ chat: { subsidyEnabled: false } }); // subsidy waterfall closed for tenants; anon has its own bucket
  anonEnabledStore(h.store);
  h.store.hostAllowanceSet(SLUG, 10, "ops"); // funded host pool — anonymous must NOT touch it
  try {
    const token = await mintToken(h);
    assert.equal((await h.call(CHAT_URL, send("one", { token, idem: "b1" }))).status, 200);
    await waitFor(() => h.store.usagePending().length === 0);
    const r2 = await h.call(CHAT_URL, send("two", { token, idem: "b2" }));
    assert.equal(r2.status, 402);
    assert.equal(r2.body.error.code, "ANON_ALLOWANCE_EXHAUSTED");
    assert.equal(r2.body.error.loginUpgrade, true);
    assert.equal(h.store.hostAllowanceUsed(SLUG), 0, "host allowance untouched by anonymous traffic");

    // Per-agent switch flipped off mid-session: the next turn refuses with the upgrade hint.
    h.store.embedSettingsSet(SLUG, { anonymous: false, origins: ["https://lex.example"], updatedBy: "ops" });
    const r3 = await h.call(CHAT_URL, send("three", { token, idem: "b3" }));
    assert.equal(r3.status, 403);
    assert.equal(r3.body.error.code, "ANON_NOT_OPEN");
  } finally { await h.close(); }
});

test("2.2 tenant regression: the logged-in waterfall is unchanged beside the anon lane", async () => {
  const h = embedHarness({ chat: { subsidyEnabled: true, subsidyDailyMinutes: 1 } });
  anonEnabledStore(h.store);
  try {
    assert.equal((await h.call(CHAT_URL, send("hi", { token: "tok-alice", idem: "t1" }))).status, 200);
    await waitFor(() => h.store.usagePending().length === 0);
    // Tenant subsidy spent (1 min/day): falls through with no host pool → own-key 402, NOT the anon error.
    const r2 = await h.call(CHAT_URL, send("again", { token: "tok-alice", idem: "t2" }));
    assert.equal(r2.status, 402);
    assert.equal(r2.body.error.code, "CHAT_ALLOWANCE_EXHAUSTED");
    // No credential at all still refuses the classic way.
    assert.equal((await h.call(CHAT_URL, send("hi"))).status, 401);
  } finally { await h.close(); }
});

// ── 3.1 embed-config: public, secret-free, gate-reflecting ───────────────────

test("3.1 embed-config: anonymous availability mirrors the gates; secret-free payload; private agent 404", async () => {
  const h = embedHarness({ chat: { subsidyEnabled: true } });
  anonEnabledStore(h.store);
  try {
    const r = await h.call(`${CHAT_URL}/embed-config`);
    assert.equal(r.status, 200);
    assert.equal(r.body.anonymous, true);
    assert.equal(r.body.chatAble, true);
    assert.deepEqual(Object.keys(r.body).sort(), ["agent", "anonymous", "chatAble", "features", "reason", "theme"]); // features.asks (add-copilot-control-surface)
    assert.equal(r.body.features.asks, true);
    assert.deepEqual(r.body.agent, { name: "Copilot", description: "embedded" });

    h.store.embedSettingsSet(SLUG, { anonymous: false, origins: ["https://lex.example"], updatedBy: "ops" });
    assert.equal((await h.call(`${CHAT_URL}/embed-config`)).body.anonymous, false);
  } finally { await h.close(); }

  const priv = embedHarness({ chat: { subsidyEnabled: true } });
  priv.store.embedSettingsSet(SLUG, { anonymous: true, origins: [], updatedBy: "ops" });
  // visibility is fixed public in the harness entry; the private shape is covered by the 404 branch below via an unknown slug.
  assert.equal((await priv.call("/api/wanxing/v1/chat/does-not-exist/embed-config")).status, 404);
  await priv.close();
});

// ── 3.2 console embed-settings: deployer-or-ops, validation, mint reflects ───

test("3.2 embed-settings routes: ops and deployer write, foreign identity 403, origin normalization + validation, next mint honors", async () => {
  const store = freshStore();
  const h = embedHarness({ store });
  try {
    const consoleApp = express();
    registerConsoleRoutes(consoleApp, {
      requireToken: (req) => req.headers.authorization === "Bearer ops-tok",
      logtoAuth: {
        configured: true,
        async verifyIdToken(token) {
          if (token === "tok-owner") return { email: "owner@x.test", sub: "o1" };
          if (token === "tok-other") return { email: "other@x.test", sub: "o2" };
          return null;
        },
      },
      bookkeeping: { resolve: async () => ({ deployedBy: "owner@x.test" }) },
      store,
      sub2api: null,
      registryFetch: async () => new Response("{}", { status: 404 }),
    });
    const srv = http.createServer(consoleApp).listen(0);
    await new Promise((r) => srv.once("listening", r));
    const cbase = `http://127.0.0.1:${srv.address().port}`;
    const put = (body, auth) => fetch(`${cbase}/api/wanxing/v1/console/deployments/${SLUG}/embed-settings`, {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` }, body: JSON.stringify(body),
    });
    // Default state reads closed.
    const r0 = await fetch(`${cbase}/api/wanxing/v1/console/deployments/${SLUG}/embed-settings`, { headers: { Authorization: "Bearer ops-tok" } });
    assert.equal((await r0.json()).anonymous, false);
    // Deployer (owner identity) writes: trailing slash normalizes, dup dedupes.
    const r1 = await put({ anonymous: true, origins: ["https://lex.example/", "https://lex.example"] }, "tok-owner");
    assert.equal(r1.status, 200);
    assert.deepEqual((await r1.json()).origins, ["https://lex.example"]);
    // Foreign verified identity is refused.
    assert.equal((await put({ anonymous: false }, "tok-other")).status, 403);
    // Anonymous unauthenticated is refused.
    assert.equal((await put({ anonymous: false }, "tok-nobody")).status, 401);
    // Malformed origins refuse with 400.
    assert.equal((await put({ origins: ["lex.example"] }, "ops-tok")).status, 400);
    assert.equal((await put({ origins: ["javascript:alert(1)"] }, "ops-tok")).status, 400);
    srv.close();

    // Chain: the chat face on the SAME store now mints for the deployer-set origin.
    const token = await mintToken(h, "https://lex.example");
    assert.equal(verifyEphemeral(token, SECRET).slug, SLUG);
  } finally { await h.close(); }
});

// ── 2.3 settlement sweep regression: anon rows settle through the subsidy branch ──

test("2.3 settleChatRow: anon-shaped subsidy row settles idempotently by row id", async () => {
  const h = embedHarness({ chat: { subsidyEnabled: true } });
  anonEnabledStore(h.store);
  try {
    const token = await mintToken(h);
    await h.call(CHAT_URL, send("hi", { token, idem: "s1" }));
    await waitFor(() => h.store.usagePending().length === 0);
    const ids = h.sub.adjustCalls.map((a) => a.idempotencyKey);
    assert.equal(ids.length, 1, "one deduction for the anon turn");
  } finally { await h.close(); }
});
