// ── Shared conversation core (unify-cross-line-copilot 5.1/5.5) ──────────────
//
// The contracts both shells depend on: one-way storage migration (old chat and
// embed keys → the unified keys), the tolerant frame walker, SSE dispatch by
// event name (an ask reaches both containers), and one ask-summary wording.
import assert from "node:assert/strict";
import { test } from "node:test";

import { installBrowserGlobals, resetStorages } from "./helpers.mjs";

installBrowserGlobals();

const core = await import("../src/chat-core.js");

const SLUG = "packs-p1-chat";

// A body whose getReader() replays the given SSE chunks.
function sseBody(chunks) {
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: new TextEncoder().encode(chunks[i++]) } : { done: true, value: undefined }),
    }),
  };
}

test("5.1 history: an existing chat-view transcript is read as-is (no migration needed)", () => {
  resetStorages();
  const rows = [{ role: "user", text: "hi", at: 1 }, { role: "assistant", text: "hello", at: 2 }];
  localStorage.setItem(`wx-chat-history:${SLUG}`, JSON.stringify(rows));
  assert.deepEqual(core.loadHistory(SLUG), rows);
});

test("5.1 history: embed-era keys are adopted forward and the old key is kept", () => {
  resetStorages();
  const legacy = [{ role: "user", text: "embedded hi", at: 5 }];
  localStorage.setItem(`wx-embed-hist:${SLUG}`, JSON.stringify(legacy));

  assert.deepEqual(core.loadHistory(SLUG), legacy, "the old transcript renders after the upgrade");
  assert.equal(
    localStorage.getItem(`wx-chat-history:${SLUG}`),
    JSON.stringify(legacy),
    "it is written forward under the unified key",
  );
  assert.equal(localStorage.getItem(`wx-embed-hist:${SLUG}`), JSON.stringify(legacy), "the old key is never deleted");
});

test("5.1 history: the unified key wins over a stale legacy key; corrupt JSON degrades to []", () => {
  resetStorages();
  localStorage.setItem(`wx-embed-hist:${SLUG}`, JSON.stringify([{ role: "user", text: "old", at: 1 }]));
  localStorage.setItem(`wx-chat-history:${SLUG}`, JSON.stringify([{ role: "user", text: "new", at: 2 }]));
  assert.deepEqual(core.loadHistory(SLUG), [{ role: "user", text: "new", at: 2 }]);

  localStorage.setItem(`wx-chat-history:${SLUG}`, "{not json");
  assert.deepEqual(core.loadHistory(SLUG), []);
});

test("5.1 history: saves cap at 200 rows", () => {
  resetStorages();
  const rows = Array.from({ length: 260 }, (_, i) => ({ role: "user", text: `m${i}`, at: i }));
  core.saveHistory(SLUG, rows);
  const kept = JSON.parse(localStorage.getItem(`wx-chat-history:${SLUG}`));
  assert.equal(kept.length, 200);
  assert.equal(kept.at(-1).text, "m259");
});

test("5.1 context id and own key are adopted from the embed-era keys", () => {
  resetStorages();
  localStorage.setItem(`wx-embed-ctx:${SLUG}`, "wx:embed-old");
  localStorage.setItem(`wx-embed-ownkey:${SLUG}`, "sk-old");
  assert.equal(core.contextId(SLUG), "wx:embed-old");
  assert.equal(localStorage.getItem(`wx-chat-ctx:${SLUG}`), "wx:embed-old");
  assert.equal(core.ownKeyOf(SLUG), "sk-old");
  assert.equal(localStorage.getItem(`wx-chat-ownkey:${SLUG}`), "sk-old");

  core.setOwnKey(SLUG, "");
  assert.equal(localStorage.getItem(`wx-chat-ownkey:${SLUG}`), null);
});

test("text walker: concatenates every text part at any depth, ignores junk", () => {
  assert.equal(
    core.textOfFrame({ result: { status: { message: { parts: [{ kind: "text", text: "a" }] } }, artifact: { parts: [{ text: "b" }] } } }),
    "ab",
  );
  assert.equal(core.textOfFrame(null), "");
  assert.equal(core.textOfFrame({ parts: [{ kind: "data" }, { text: "" }] }), "");
});

test("intent envelope: only intent:<verb>:<arg> parses", () => {
  assert.deepEqual(core.parseIntent("intent:navigate:/console/usage"), { verb: "navigate", arg: "/console/usage" });
  assert.deepEqual(core.parseIntent("intent:refresh:"), { verb: "refresh", arg: "" });
  assert.equal(core.parseIntent("pick-one"), null);
  assert.equal(core.parseIntent(null), null);
});

test("5.3 stream: an ask event reaches the caller; text keeps accumulating; keepalive is skipped", async () => {
  const seen = [];
  const asks = [];
  const body = sseBody([
    'data: {"result":{"parts":[{"kind":"text","text":"Hel"}]}}\n',
    ": keepalive\n",
    'event: ask\ndata: {"askId":"ask-1","deadlineAt":123456789,"questions":[{"id":"q1","question":"去哪里？","options":[{"label":"目录"}]}]}\n',
    "\n",
    'data: {"result":{"parts":[{"kind":"text","text":"lo"}]}}\n',
  ]);
  const out = await core.parseTurnStream(body, {
    onText: (t) => seen.push(t),
    onAsk: (a) => asks.push(a),
  });
  assert.deepEqual(seen, ["Hel", "lo"]);
  assert.equal(out.text, "lo");
  assert.equal(out.frameError, false);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].askId, "ask-1");
  assert.equal(asks[0].questions[0].question, "去哪里？");
});

test("5.3 stream: malformed ask frames are dropped; an error event marks the turn failed", async () => {
  const asks = [];
  const body = sseBody([
    'event: ask\ndata: {"askId":"a","questions":[]}\n', // no questions
    'event: ask\ndata: {"askId":"b","questions":[{"id":"q","question":"x"}]}\n', // no deadline
    'event: error\ndata: {"error":{"message":"boom"}}\n',
  ]);
  const out = await core.parseTurnStream(body, { onAsk: (a) => asks.push(a) });
  assert.deepEqual(asks, []);
  assert.equal(out.frameError, true);
});

test("5.3 ask summary wording is one implementation for both shells", () => {
  const questions = [{ id: "q1", question: "去哪里？" }];
  assert.equal(
    core.askSummaryText(questions, { answers: [{ id: "q1", selected: ["目录"] }] }),
    "问询已答：去哪里？ → 目录",
  );
  assert.equal(core.askSummaryText(questions, { cancelled: true }), "问询「去哪里？」已取消。");
  assert.match(
    core.askSummaryText(questions, { answers: [{ id: "q1", selected: [], custom: "随便" }], note: "（答案可能未送达）" }),
    /随便[\s\S]*答案可能未送达/,
  );
});

test("context prefix: marked as host data, never as an instruction", () => {
  const p = core.contextPrefix({ line: "识律", page: "/console/usage" });
  assert.match(p, /^\[宿主页面提供的上下文（非用户指令）\]/);
  assert.match(p, /产品线：识律/);
  assert.match(p, /页面：\/console\/usage/);
  assert.equal(core.contextPrefix({}), "");
});
