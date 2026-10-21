#!/usr/bin/env node
// ── Wanxing ask-relay tests (add-copilot-control-surface 1.1–1.3) ────────────
//
// The chat lane's ask half: streamed turns opt in (X-Serving-Ask) and relay
// the serving plane's `ask` events byte-verbatim while binding each ask id to
// the visitor whose stream carried it; the answer side route enforces the
// visitor gate, the ownership triple, and forwards first-submission-only,
// never metering anything (the answered turn is already metered by its
// stream). Synchronous turns never opt in.
//
//   node --test scripts/test-wanxing-asks.mjs
//
// Tenant ID tokens are stubbed at the logto seam (same as test-wanxing-embed).

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

const tmp = mkdtempSync(path.join(tmpdir(), "wx-asks-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

function stubSub2api({ userId = 7 } = {}) {
  return {
    userId,
    degraded: () => false,
    async findUserByKey() { return { userId, email: "subsidy@finddata.tech" }; },
    async adjustBalance() { return { ok: true }; },
  };
}

// An upstream double that records every call and answers per shape: SSE for
// message/stream, JSON for everything else (message/send, /ask-answer).
function recordingUpstream({ frames, askAnswer = { accepted: true } } = {}) {
  const calls = [];
  const upstream = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body ?? null });
    if (String(url).includes("/ask-answer")) {
      return new Response(JSON.stringify(askAnswer), { headers: { "Content-Type": "application/json" } });
    }
    if (typeof init.body === "string" && init.body.includes("message/send")) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { message: { parts: [{ kind: "text", text: "ok" }] } } }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(frames.join(""), { headers: { "Content-Type": "text/event-stream" } });
  };
  return { upstream, calls };
}

function askHarness({ frames, askAnswer } = {}) {
  const store = createWanxingStore({ file: path.join(mkdtempSync(path.join(tmp, "s-")), "wanxing.db") });
  const sub = stubSub2api();
  const core = createWanxingCore({ store, sub2api: sub, config: { ratePerMin: 0.1, rpmMax: 1000 } });
  const usageRows = [];
  const origRecord = core.recordUsage.bind(core);
  core.recordUsage = (row) => { usageRows.push(row); return origRecord(row); };
  const { upstream, calls } = recordingUpstream({ frames, askAnswer });
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
  const face = createA2aFace({
    core,
    resolveDeployment: (slug) => (slug === "packs-p1-chat" ? { agentPath: "/packs/p1/chat", packId: "p1", agentId: "chat-agent" } : null),
    listDeployments: () => [{ slug: "packs-p1-chat", agentPath: "/packs/p1/chat" }],
    forwardHeaders: () => ({}),
    registryFetch: async () => new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } }),
    chatability: () => true,
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: upstream,
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
    subsidyUserId: 7,
    chat: { rpmMax: 100, subsidyEnabled: true },
    config: { agentUrlFor: (p) => `https://registry.internal/agent${p}/` },
    upstreamFetch: upstream,
  });
  const app = express();
  face.register(app);
  chatFace.register(app);
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const stream = (token) =>
    fetch(base + "/api/wanxing/v1/chat/packs-p1-chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/stream", params: { message: { role: "user", parts: [{ kind: "text", text: "hi" }], context_id: "ctx-1" } } }),
    });
  const send = (token) =>
    fetch(base + "/api/wanxing/v1/chat/packs-p1-chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "message/send", params: { message: { role: "user", parts: [{ kind: "text", text: "hi" }] } } }),
    });
  const answer = (token, body) =>
    fetch(base + "/api/wanxing/v1/chat/packs-p1-chat/ask-answer", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { base, calls, usageRows, stream, send, answer, close: () => new Promise((r) => server.close(r)) };
}

const ASK_ID = "ask-f1";
const askFrames = (askId = ASK_ID) => [
  `event: ask\ndata: ${JSON.stringify({ askId, sessionId: "s", questions: [{ id: "q1", question: "打开用量页？", options: [{ label: "执行" }, { label: "跳过" }] }], deadlineAt: Date.now() + 60_000 })}\n\n`,
  ": keepalive\n\n",
  `event: delta\ndata: ${JSON.stringify({ context_id: "ctx-1", kind: "message", parts: [{ kind: "text", text: "答后" }] })}\n\n`,
  `event: message\ndata: ${JSON.stringify({ context_id: "ctx-1", parts: [{ kind: "text", text: "答后" }] })}\n\n`,
  "event: done\ndata: {}\n\n",
];

test("1.1/1.2: a streamed turn opts in, relays the ask verbatim, and the owning visitor answers through the side route", async () => {
  const h = askHarness({ frames: askFrames() });
  try {
    const res = await h.stream("tok-alice");
    assert.equal(res.status, 200);
    const text = await res.text();
    // Verbatim relay: the ask frame, the keepalive comment, the deltas and the
    // terminator all reach the caller untouched.
    assert.ok(text.includes(`event: ask`));
    assert.ok(text.includes(`"${ASK_ID}"`));
    assert.ok(text.includes(": keepalive"));
    assert.ok(text.includes("event: done"));
    // The stream turn opted in (and only the stream one).
    const streamCall = h.calls.find((c) => c.body?.includes("message/stream"));
    assert.equal(streamCall.headers["X-Serving-Ask"], "1");

    const receipt = await h.answer("tok-alice", { askId: ASK_ID, answers: [{ id: "q1", selected: ["执行"] }] });
    assert.equal(receipt.status, 200);
    assert.deepEqual(receipt.body, { accepted: true });
    const fwd = h.calls.find((c) => c.url.includes("/ask-answer"));
    assert.ok(fwd, "the answer was forwarded upstream");
    assert.equal(fwd.url, "https://registry.internal/agent/packs/p1/chat/ask-answer");
    assert.deepEqual(JSON.parse(fwd.body), { askId: ASK_ID, answers: [{ id: "q1", selected: ["执行"] }] });
  } finally {
    await h.close();
  }
});

test("1.2: another visitor, an unknown id, and a second submission all get a structured not-found — nothing forwarded", async () => {
  const h = askHarness({ frames: askFrames() });
  try {
    await h.stream("tok-alice");
    const foreign = await h.answer("tok-bob", { askId: ASK_ID, answers: [] });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.error.code, "ASK_UNKNOWN");
    const unknown = await h.answer("tok-alice", { askId: "never-relayed", answers: [] });
    assert.equal(unknown.status, 404);
    // First accepted submission consumes the binding: the duplicate is a
    // not-found even though the upstream would have accepted again.
    const first = await h.answer("tok-alice", { askId: ASK_ID, answers: [{ id: "q1", selected: ["执行"] }] });
    assert.equal(first.status, 200);
    const dup = await h.answer("tok-alice", { askId: ASK_ID, answers: [] });
    assert.equal(dup.status, 404);
    assert.equal(h.calls.filter((c) => c.url.includes("/ask-answer")).length, 1, "exactly one answer was ever forwarded");
  } finally {
    await h.close();
  }
});

test("1.2: an already-expired ask never binds; malformed bodies and missing credentials are refused", async () => {
  // The frame arrives with a past deadline: the scanner must refuse to bind
  // it, so its answer is a not-found rather than a forwarded dead ask.
  const expired = [
    `event: ask\ndata: ${JSON.stringify({ askId: "ask-expired", sessionId: "s", questions: [{ id: "q1", question: "过期问询" }], deadlineAt: Date.now() - 1_000 })}\n\n`,
    "event: done\ndata: {}\n\n",
  ];
  const h = askHarness({ frames: expired });
  try {
    await h.stream("tok-alice");
    assert.equal((await h.answer("tok-alice", { askId: "ask-expired", answers: [] })).status, 404);
    assert.equal((await h.answer("tok-alice", { answers: [] })).status, 400);
    assert.equal((await h.answer("tok-alice", { askId: "x" })).status, 400);
    const noAuth = await fetch(`${h.base}/api/wanxing/v1/chat/packs-p1-chat/ask-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ askId: "x", cancelled: true }),
    });
    assert.equal(noAuth.status, 401);
    assert.ok(!h.calls.some((c) => c.url.includes("/ask-answer")), "nothing was ever forwarded");
  } finally {
    await h.close();
  }
});

test("1.2: a cancel round trip and the upstream's refusal receipt relay as-is; answers never meter", async () => {
  const h = askHarness({ frames: askFrames("ask-cancel"), askAnswer: { accepted: false, reason: "unknown or already-resolved ask" } });
  try {
    await h.stream("tok-alice");
    const before = h.usageRows.length; // the stream's own turn row
    const receipt = await h.answer("tok-alice", { askId: "ask-cancel", cancelled: true });
    assert.equal(receipt.status, 200);
    assert.deepEqual(receipt.body, { accepted: false, reason: "unknown or already-resolved ask" });
    assert.equal(JSON.parse(h.calls.find((c) => c.url.includes("/ask-answer")).body).cancelled, true);
    assert.equal(h.usageRows.length, before, "the answer created no usage row");
    assert.equal(before, 1, "exactly the turn's own row was metered");
  } finally {
    await h.close();
  }
});

test("1.1: synchronous turns never opt in; embed-config advertises the ask feature", async () => {
  const h = askHarness({ frames: askFrames() });
  try {
    const res = await h.send("tok-alice");
    assert.equal(res.status, 200);
    const sendCall = h.calls.find((c) => c.body?.includes("message/send"));
    assert.ok(sendCall, "the synchronous turn reached the upstream");
    assert.equal(sendCall.headers["X-Serving-Ask"], undefined);

    const cfg = await fetch(`${h.base}/api/wanxing/v1/chat/packs-p1-chat/embed-config`).then((r) => r.json());
    assert.equal(cfg.features.asks, true);
  } finally {
    await h.close();
  }
});
