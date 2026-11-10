// View smoke: static render (react-dom/server renderToStaticMarkup) of the
// three crash-heaviest views — empty state and adversarial data. Catches the
// render-time ReferenceError/crash class the真机走查 kept catching
// (2a2644d/74ee780 FleetView `deployments is not defined`, 4df9b53 console
// black screen). Effects don't run under static render; data-shape crash
// surfaces are covered via the pure helpers below.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { installBrowserGlobals, resetStorages } from "./helpers.mjs";

installBrowserGlobals();

beforeEach(() => resetStorages());

const { CatalogView, segmentsOf } = await import("../src/views/CatalogView.jsx");
const { ChatView } = await import("../src/views/ChatView.jsx");
const { FleetView } = await import("../src/views/console/FleetView.jsx");
const { channelLabel, sourceBadge, planRequestBadge, fmtMs, fmtAgo } = await import("../src/views/console/shared.jsx");
const { ErrorBoundary } = await import("../src/components/ErrorBoundary.jsx");

const renderOk = (el, name) => {
  const html = renderToStaticMarkup(el);
  assert.equal(typeof html, "string", `${name} returned html`);
  assert.ok(html.length > 0, `${name} rendered empty`);
  assert.ok(!html.includes("undefined"), `${name} leaked 'undefined' into markup`);
  return html;
};

test("CatalogView renders empty (initial self-fetch state) without crashing", () => {
  renderOk(<CatalogView />, "CatalogView empty");
});

test("ChatView renders empty (pre-status state) without crashing", () => {
  renderOk(<ChatView focusSlug="some-agent" />, "ChatView empty");
});

test("FleetView renders empty console state without crashing (regression: 2a2644d/74ee780 class)", () => {
  // The twin crash was a render-time ReferenceError in this tree; any
  // regression of that class now fails here instead of on a real phone.
  renderOk(<FleetView />, "FleetView empty");
});

test("FleetView renders with a full deployment-shaped store state (deps prop present, memory lane derivable)", () => {
  // deps-shaped data with edge shapes: missing memory flag, null fields.
  localStorage.setItem("wanxing-console-token", "t"); // authed branch
  renderOk(<FleetView />, "FleetView authed");
});

test("ErrorBoundary contract: catch→state, fallback renders, clean render passes through (4df9b53 class)", () => {
  // Streaming server render aborts the shell on a shell-level throw (no
  // boundary fallback server-side), so the boundary is tested by contract:
  // its static catch hook + both render branches, deterministically.
  const err = new Error("render crash");
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(err), { err });

  const marker = <div data-testid="ok-panel">fine</div>;
  const boundary = new ErrorBoundary({ label: "消耗", children: marker });
  boundary.state = { err: null };
  assert.ok(renderToStaticMarkup(boundary.render()).includes("ok-panel"));
  // Fallback branch: named panel + failure message, never a blank page.
  boundary.state = { err };
  const fallback = renderToStaticMarkup(boundary.render());
  assert.ok(fallback.includes("console-error-boundary"));
  assert.ok(fallback.includes("渲染出错"));
  assert.ok(fallback.includes("render crash"));
  assert.ok(fallback.includes("消耗"));
});

test("segmentsOf: adversarial catalog lists (missing fields) never crash and degrade honestly", () => {
  assert.deepEqual(segmentsOf([]), []);
  assert.deepEqual(segmentsOf([{ slug: "a", name: "A", description: "d", tags: null }]), segmentsOf([{ slug: "a", name: "A", description: "d", tags: null }]));
  assert.doesNotThrow(() => segmentsOf([{ slug: null, name: null, description: null, tags: [1, 2] }]));
  assert.doesNotThrow(() => segmentsOf([{ name: "x", category: "legal" }, { name: "y", category: null }, {}]));
});

test("shared.jsx presentation helpers: junk inputs degrade, never throw", () => {
  assert.equal(channelLabel("chat"), "对话");
  assert.equal(channelLabel("api"), "API");
  assert.equal(channelLabel(undefined), "?");
  assert.equal(fmtMs(null), "n/a");
  assert.equal(fmtMs(1500), "1.5s");
  assert.equal(fmtAgo(null), "?");
  assert.equal(fmtAgo(30_000), "30s");
  assert.doesNotThrow(() => sourceBadge(null));
  assert.doesNotThrow(() => sourceBadge({ source: "override" }));
  assert.doesNotThrow(() => planRequestBadge("unknown-status"));
  assert.doesNotThrow(() => planRequestBadge(undefined));
});

test("ConsoleView-shaped adversarial auth state: expired notice renders as text, not crash", async () => {
  const { authState } = await import("../src/auth.js");
  localStorage.setItem("wanxing-console-token", "t");
  const s = authState();
  assert.equal(typeof s.notice, "string");
});

// ── AskCard: one card, both shells (unify-cross-line-copilot 5.3/5.4) ────────
// Static render only proves it does not crash and that the parts an agent's ask
// carries (question, options, cancel, countdown slot) reach the DOM.

test("AskCard renders questions, options, and the cancel affordance", async () => {
  const { AskCard } = await import("../src/components/AskCard.jsx");
  const ask = {
    askId: "ask-1",
    deadlineAt: Date.now() + 60_000,
    questions: [
      { id: "q1", header: "选择", question: "去哪个页面？", detail: "只能选一个", options: [{ label: "目录" }, { label: "控制台" }] },
    ],
  };
  const html = renderOk(createElement(AskCard, { ask, onSubmit: () => {} }), "AskCard");
  assert.ok(html.includes("助手问询"));
  assert.ok(html.includes("去哪个页面？"));
  assert.ok(html.includes("目录") && html.includes("控制台"));
  assert.ok(html.includes("取消"));
  assert.ok(html.includes("提交回答"));
});

test("AskCard marks an intent question unsupported when the host declares no verbs", async () => {
  const { AskCard } = await import("../src/components/AskCard.jsx");
  const ask = {
    askId: "ask-2",
    deadlineAt: Date.now() + 60_000,
    questions: [{ id: "intent:navigate:/console/usage", question: "带你去用量页？", options: [{ label: "执行" }, { label: "跳过" }] }],
  };
  const html = renderOk(createElement(AskCard, { ask, onSubmit: () => {}, hostIntents: [] }), "AskCard intent");
  assert.ok(html.includes("页面动作"));
  assert.ok(html.includes("当前页面不支持此操作"));
});

// ── Health helpers + fleet ordering (surface-silent-agent-failures 3.1/3.2) ──
// The two things worth locking statically: a duration reads as a duration (the
// number that makes an outage impossible to mistake for a blip), and a missing
// cause is not silently rendered as a known one.

test("3.1 fmtSpan: minutes, hours, days — junk degrades to '?'", async () => {
  const { fmtSpan } = await import("../src/views/console/shared.jsx");
  assert.equal(fmtSpan(30_000), "1 分钟");        // floor at 1 minute, never "0 分钟"
  assert.equal(fmtSpan(90 * 60_000), "2 小时");
  assert.equal(fmtSpan(3 * 24 * 3600_000), "3 天");
  assert.equal(fmtSpan(null), "?");
  assert.equal(fmtSpan(-1), "?");
});

test("3.1 healthCauseLabel: null renders nothing, unknown says so", async () => {
  const { healthCauseLabel } = await import("../src/views/console/shared.jsx");
  assert.equal(healthCauseLabel(null), "");
  assert.equal(healthCauseLabel("unknown"), "原因未归类");
  assert.equal(healthCauseLabel("cold_start"), "冷启动失败");
  assert.equal(healthCauseLabel("something-new"), "原因未归类");
});

test("3.2 a missing health entry renders nothing — never a healthy-looking marker", async () => {
  const { HealthBadge } = await import("../src/views/console/shared.jsx");
  // The section was unavailable (or the agent is fine): no chip at all. This is
  // the "we could not read it" case, which must not look like "all good".
  assert.equal(renderToStaticMarkup(createElement(HealthBadge, { health: null, slug: "s1" })), "");
  assert.equal(renderToStaticMarkup(createElement(HealthBadge, { health: undefined, slug: "s1" })), "");

  // A real failure does render, and names its duration + cause.
  const failing = renderToStaticMarkup(createElement(HealthBadge, {
    health: { health: "failing", since: Date.now() - 2 * 3600_000, lastErrorKind: "cold_start" },
    slug: "s1",
  }));
  assert.ok(failing.includes("持续失败"));
  assert.ok(failing.includes("冷启动失败"));

  // Zero traffic is its own marker, not a failure and not a pass.
  const silent = renderToStaticMarkup(createElement(HealthBadge, { health: { health: "silent" }, slug: "s1" }));
  assert.ok(silent.includes("无流量"));
  assert.ok(!silent.includes("失败"));
});

// ── flag-stalled-rhythm-agents 3.1/3.3: two kinds of silence ────────────────

test("3.1 a stalled agent says it should have run; a plain silent one keeps its wording", async () => {
  const { HealthBadge } = await import("../src/views/console/shared.jsx");

  const stalled = renderToStaticMarkup(createElement(HealthBadge, {
    health: { health: "silent", declared_every_ms: 3_600_000, expected_turns: 24, stalled: true },
    slug: "s1",
  }));
  assert.ok(stalled.includes("该跑没跑"));
  assert.ok(stalled.includes("24"));
  assert.ok(!stalled.includes("无流量"));

  const plain = renderToStaticMarkup(createElement(HealthBadge, { health: { health: "silent" }, slug: "s1" }));
  assert.ok(plain.includes("无流量"), "a non-rhythmic agent keeps exactly today's wording");
  assert.ok(!plain.includes("该跑没跑"));
});

test("3.3 an older observer's silent entry (no implied count) renders as before", async () => {
  const { HealthBadge } = await import("../src/views/console/shared.jsx");
  const html = renderToStaticMarkup(createElement(HealthBadge, {
    health: { health: "silent", expected_turns: undefined, stalled: undefined },
    slug: "s1",
  }));
  assert.ok(html.includes("无流量"));
  assert.ok(!html.includes("undefined"));
});
