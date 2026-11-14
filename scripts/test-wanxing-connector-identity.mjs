#!/usr/bin/env node
// ── Facade → platform connector-identity registration
// (paas add-served-agent-connector-access D3) ────────────────────────────────
//
// The facade is the only side that KNOWS who is talking, and the only side
// allowed to say so: the raw sub never travels to the serving plane, so the
// runner and the profile carry nothing. This pins what the facade sends and
// when it sends it.
//
//   1.x  a signed-in visitor registers their own sub; an anonymous visitor
//        registers the FACT of having no identity (null), never silence —
//        the platform refuses an absent registration but falls back visibly
//        for a null one, and collapsing those two is the whole bug class.
//   2.x  the scope is the same opaque hash the turn already carries in
//        metadata, so the registration and the turn describe one visitor.
//   3.x  the registration lands BEFORE the turn is sent (a race would surface
//        our own latency as a fail-closed refusal), and a failed registration
//        never blocks the turn — connectors are optional, the conversation
//        is not.
//   4.x  the sub never leaks downstream: the serving plane sees the hash, and
//        nothing in the turn body carries the subject.
//
//   node --test scripts/test-wanxing-connector-identity.mjs

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const tmp = mkdtempSync(path.join(tmpdir(), "wx-connector-identity-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const SLUG = "packs-p1-chat";
const CHAT_URL = `/api/wanxing/v1/chat/${SLUG}`;
const SECRET = "unit-embed-secret";
const sha256 = (v) => createHash("sha256").update(String(v)).digest("hex");

const jsonReply = () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: { parts: [{ kind: "text", text: "queued" }] } } }), {
    headers: { "Content-Type": "application/json" },
  });

function stubSub2api({ userId = 7 } = {}) {
  return {
    userId,
    degraded: () => false,
    async findUserByKey() { return { userId, email: "subsidy@finddata.tech" }; },
    async adjustBalance() { return { ok: true }; },
  };
}

const freshStore = () => createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });

/**
 * One facade with a recording registration seam. `events` interleaves the
 * registration and the upstream turn on a single timeline, which is how the
 * ordering law (register first) is asserted rather than assumed.
 */
function harness({ registerConnectorActor = async () => ({ ok: true }), withRegister = true, upstream = () => jsonReply() } = {}) {
  const store = freshStore();
  const sub = stubSub2api();
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
  const events = [];
  const registrations = [];
  const upstreamCalls = [];
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === SLUG ? { agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent" } : null),
    listDeployments: () => [{ slug: SLUG, agentPath: "/packs/p1/chat" }],
    forwardHeaders: () => ({}),
    registryFetch: async () => new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } }),
    chatability: () => true,
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async () => upstream(),
  });
  const chatFace = createChatFace({
    core,
    store,
    logto: logtoStub,
    agentState: (slug) => face.agentState(slug),
    resolveDeployment: async (slug) => (slug === SLUG ? { packId: "p1", agentId: "chat-agent", agentPath: "/packs/p1/chat" } : null),
    forwardHeaders: () => ({}),
    hostSettle: async () => ({ settled: true, duplicate: false }),
    registerConnectorActor: withRegister
      ? async (payload) => {
          events.push("register");
          registrations.push(payload);
          return registerConnectorActor(payload);
        }
      : undefined,
    sub2api: sub,
    subsidyKey: "sk-platform",
    subsidyUserId: 7,
    chat: {
      rpmMax: 100,
      subsidyEnabled: true,
      embed: { anonEnabled: true, anonDailyMinutes: 1, embedSecret: SECRET, embedOrigins: ["https://lex.example"], embedTtlMs: 60_000, mintRpmMax: 50 },
    },
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: async (url, init) => {
      events.push("turn");
      upstreamCalls.push({ url: String(url), body: init?.body ?? null });
      return upstream();
    },
  });
  const app = express();
  face.register(app);
  chatFace.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    store,
    events,
    registrations,
    upstreamCalls,
    call: (p, opts = {}) => fetch(base + p, opts).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
    send: (token) =>
      fetch(base + CHAT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "hi" }] } } }),
      }),
    mintAnon: async () => {
      store.embedSettingsSet(SLUG, { anonymous: true, origins: ["https://lex.example"], updatedBy: "ops" });
      const r = await fetch(base + `${CHAT_URL}/visitor-token`, { method: "POST", headers: { Origin: "https://lex.example" } });
      assert.equal(r.status, 201, "the anon token mint must succeed for this case to mean anything");
      return (await r.json()).token;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

test("1.1 a signed-in visitor registers their own sub", async () => {
  const h = harness();
  try {
    const res = await h.send("tok-alice");
    assert.equal(res.status, 200);
    assert.equal(h.registrations.length, 1);
    assert.deepEqual(h.registrations[0], {
      packId: "p1",
      agentId: "chat-agent",
      agentPath: "/packs/p1/chat",
      scope: sha256("visitor:sub-alice").slice(0, 32),
      actor: "sub-alice",
    });
  } finally {
    await h.close();
  }
});

test("1.2 an anonymous visitor registers the FACT of having no identity — null, not silence", async () => {
  const h = harness();
  try {
    const token = await h.mintAnon();
    const res = await h.send(token);
    assert.equal(res.status, 200);
    assert.equal(h.registrations.length, 1);
    // The key must be present and null: the platform refuses an absent
    // registration but falls back visibly for a null one.
    assert.ok(Object.hasOwn(h.registrations[0], "actor"));
    assert.equal(h.registrations[0].actor, null);
    assert.notEqual(h.registrations[0].actor, undefined);
  } finally {
    await h.close();
  }
});

test("2.1 the registered scope is exactly the scope the turn carries", async () => {
  const h = harness();
  try {
    await h.send("tok-bob");
    const turnBody = JSON.parse(h.upstreamCalls[0].body);
    const inTurn = turnBody.params.message.metadata.visitor_scope;
    assert.equal(h.registrations[0].scope, inTurn, "registration and turn must describe one visitor");
    assert.match(inTurn, /^[0-9a-f]{32}$/);
  } finally {
    await h.close();
  }
});

test("3.1 the registration lands BEFORE the turn is sent", async () => {
  const h = harness();
  try {
    await h.send("tok-carol");
    assert.deepEqual(h.events, ["register", "turn"]);
  } finally {
    await h.close();
  }
});

test("3.2 a failed registration never blocks the turn", async () => {
  const h = harness({ registerConnectorActor: async () => { throw Object.assign(new Error("boom"), { status: 503 }); } });
  try {
    const res = await h.send("tok-dave");
    assert.equal(res.status, 200, "the conversation must survive a connector-plane hiccup");
    assert.deepEqual(h.events, ["register", "turn"]);
    assert.equal(h.upstreamCalls.length, 1);
  } finally {
    await h.close();
  }
});

test("4.1 the raw sub never travels downstream", async () => {
  const h = harness();
  try {
    await h.send("tok-erin");
    const turnBody = h.upstreamCalls[0].body;
    assert.doesNotMatch(turnBody, /sub-erin/, "the serving plane must not see the subject");
    // ...but the registration does carry it — that is the whole point of the
    // separate channel: the actor is how the PLATFORM learns who to act as.
    assert.equal(h.registrations[0].actor, "sub-erin");
  } finally {
    await h.close();
  }
});

test("4.2 with no registration seam configured the turn is byte-identical and nothing throws", async () => {
  const h = harness({ withRegister: false });
  try {
    const res = await h.send("tok-frank");
    assert.equal(res.status, 200);
    assert.equal(h.registrations.length, 0);
    assert.equal(h.upstreamCalls.length, 1);
  } finally {
    await h.close();
  }
});
