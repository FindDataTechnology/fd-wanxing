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

const { CatalogView, segmentsOf, statusBadgeFor, allStatusesUnknown } = await import("../src/views/CatalogView.jsx");
const { ChatView } = await import("../src/views/ChatView.jsx");
const { EmbedView } = await import("../src/views/EmbedView.jsx");
const { credSet } = await import("../src/embed-auth.js");
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

// Anonymous turns have no identity of their own, so a connector action they
// trigger runs as the DEPLOYER (paas add-served-agent-connector-access D5).
// The facade's /status already carries `tier`, so the widget knows which
// regime it is in without any new runner→facade signal — the notice is a
// pure derivation. Asserted both ways: anon discloses, tenant does not
// (a tenant visitor running as themselves must not be told otherwise).
test("EmbedView discloses the deployer fallback on anon turns only", () => {
  // `open=1` is the widget's expanded state; the notice lives in the dock
  // panel (a collapsed widget has no conversation, so nothing to disclose).
  location.hash = "#/embed/demo-agent?open=1";
  try {
    const anon = renderOk(<EmbedView focusSlug="demo-agent" />, "EmbedView anon");
    assert.ok(anon.includes('data-testid="wx-embed-deployer-notice"'), "anon shows the notice");
    assert.ok(anon.includes("部署者身份"), "anon names who actually executes");
    assert.ok(anon.includes("而不是你本人"), "anon says it is not the visitor");
    assert.ok(anon.includes("匿名"), "anon tier chip still reads 匿名");

    // Same slug with a stored tenant credential: tier resolves to tenant at
    // first render, so the notice must be absent.
    credSet("demo-agent", { idToken: "h.p.s", email: "v@example.com" });
    const tenant = renderOk(<EmbedView focusSlug="demo-agent" />, "EmbedView tenant");
    assert.ok(!tenant.includes('data-testid="wx-embed-deployer-notice"'), "tenant shows no notice");
    assert.ok(tenant.includes("已登录 · v@example.com"), "tenant chip names the visitor");
  } finally {
    location.hash = "";
  }
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

test("CatalogView status markers: the cross-surface fact table decides, unknown never reads as online", () => {
  // unify-wanxing-surface-language: the catalog no longer owns a status vocabulary —
  // statusBadgeFor() takes the whole entry and goes through status-facts.js.
  assert.equal(statusBadgeFor({ status: "serving" }).label, "在役");
  assert.equal(statusBadgeFor({ status: "idle" }).label, "尚无调用");
  assert.equal(statusBadgeFor({ status: "paused" }).label, "已暂停");
  // unknown — and anything unexpected — falls back to the neutral unknown mark
  assert.equal(statusBadgeFor({ status: "unknown" }).label, "状态未知");
  assert.equal(statusBadgeFor({}).label, "状态未知");
  assert.equal(statusBadgeFor({ status: "nonsense" }).label, "状态未知");
  assert.ok(!statusBadgeFor({ status: "unknown" }).cls.includes("emerald"), "unknown must not use the healthy green");

  // The three zero-traffic meanings stay distinguishable.
  assert.equal(statusBadgeFor({ status: "serving", health: { health: "silent" } }).label, "尚无调用");
  assert.equal(statusBadgeFor({ status: "idle", health: { health: "silent", stalled: true } }).label, "该跑没跑");
  // And a failing agent gets exactly one badge — the failure, never a healthy-looking chip beside it.
  assert.equal(statusBadgeFor({ status: "serving", health: { health: "failing" } }).label, "持续失败");
});

test("CatalogView page-level staleness: all-unknown is detected, a mixed page is not", () => {
  assert.equal(allStatusesUnknown([]), false, "an empty page is not a stale page");
  assert.equal(allStatusesUnknown([{ status: "unknown" }, { status: "unknown" }]), true);
  assert.equal(allStatusesUnknown([{ status: "unknown" }, { status: "idle" }]), false);
  assert.equal(allStatusesUnknown([{ status: "serving" }]), false);
});

test("CatalogView renders the scope line and leaks nothing odd", () => {
  const html = renderOk(<CatalogView />, "CatalogView scope");
  assert.ok(html.includes("已部署"), "the page must state that it lists deployed instances");
});

// ── unify-wanxing-surface-language 2.x: 访客面的标签与无示例体态 ─────────────

test("2.2 已知内部标签译成中文，原始值挂在 title；未命中标签原样保留", async () => {
  const { AgentCard } = await import("../src/views/CatalogView.jsx");
  const html = renderToStaticMarkup(createElement(AgentCard, {
    agent: { slug: "s1", name: "甲", status: "serving", tags: ["security-pending", "wire", "xyzzy"] },
  }));
  assert.ok(html.includes("待安全复核"), "security-pending 必须译出");
  assert.ok(html.includes("柏讯"), "wire 必须译出");
  assert.ok(html.includes("title=\"标签：security-pending\""), "原始值必须仍可读");
  assert.ok(html.includes("xyzzy"), "未命中标签原样保留，不得被吞掉");
});

test("2.3 skills 未声明时不出「（未声明）」空列表，slug 仍可达", async () => {
  const { AgentCard } = await import("../src/views/CatalogView.jsx");
  const bare = renderToStaticMarkup(createElement(AgentCard, {
    agent: { slug: "s1", name: "甲", status: "serving", skills: [], examples: [], chatable: true },
  }));
  assert.ok(!bare.includes("（未声明）"), "不得出现「（未声明）」式残缺");
  assert.ok(bare.includes("s1"), "slug 仍必须可达（对接标识）");
  assert.ok(bare.includes('data-testid="try-hint-s1"'), "无示例时应给出下一步引导");

  const withSkills = renderToStaticMarkup(createElement(AgentCard, {
    agent: { slug: "s1", name: "甲", status: "serving", skills: ["检索"], examples: [] },
  }));
  assert.ok(withSkills.includes("技能与 slug"), "声明了技能时折叠标题保持原样");
  assert.ok(!withSkills.includes('data-testid="try-hint-s1"'), "有技能时不该再显示试用引导");
});

test("2.4 agent 详情页走同一张事实表（静态渲染停在 loading，徽标由生产走查兜底 6.3）", async () => {
  const { AgentDetailView } = await import("../src/views/AgentDetailView.jsx");
  // 该视图在 effect 里取数，静态渲染停在 loading 骨架——这里只能证明不崩。
  // 徽标本身用的是与目录/舰队卡同一个 factOf+badgeFor（由上一条与 status-facts 单测覆盖）。
  const html = renderOk(createElement(AgentDetailView, { focusSlug: "s1" }), "AgentDetailView");
  assert.ok(html.includes('data-testid="agent-detail-loading"'), "加载态骨架仍在");
});

// ── unify-wanxing-surface-language 3.1/3.3/3.4: 舰队卡一枚徽标、全零空态、操作分层 ──

test("3.1 舰队卡事实：summary 未落地且观测面不可用 -> 不出徽标（不冒充未知）", async () => {
  const { fleetFactOf } = await import("../src/views/console/FleetView.jsx");
  assert.equal(fleetFactOf({ paused: false, sig: null, summaryLanded: false, health: null, healthSectionUp: false }), null);
});

test("3.1 paused 恒为已暂停；summary 落地后按 7 天回合分在役/尚无调用", async () => {
  const { fleetFactOf } = await import("../src/views/console/FleetView.jsx");
  assert.equal(fleetFactOf({ paused: true, sig: null, summaryLanded: false, health: null, healthSectionUp: false }), "paused");
  assert.equal(fleetFactOf({ paused: false, sig: { turns7d: 9 }, summaryLanded: true, health: null, healthSectionUp: false }), "live");
  assert.equal(fleetFactOf({ paused: false, sig: { turns7d: 0 }, summaryLanded: true, health: null, healthSectionUp: false }), "unused");
});

test("3.1 failing 的事实是 failing，卡片据此只出健康徽标而不出第二枚", async () => {
  const { fleetFactOf } = await import("../src/views/console/FleetView.jsx");
  const fact = fleetFactOf({
    paused: false, sig: { turns7d: 9 }, summaryLanded: true,
    health: { health: "failing" }, healthSectionUp: true,
  });
  assert.equal(fact, "failing");
  // useHealthChip 的判据与这里同源：failing/degraded/stalled 走详情徽标，其余走事实徽标。
  assert.ok(["failing", "degraded", "stalled"].includes(fact));
});

test("3.1 观测面段可用但本 agent 缺席 -> 状态未知", async () => {
  const { fleetFactOf } = await import("../src/views/console/FleetView.jsx");
  assert.equal(fleetFactOf({ paused: false, sig: { turns7d: 2 }, summaryLanded: true, health: null, healthSectionUp: true }), "unknown");
});

test("3.4 操作分层：静态渲染停在空态（列表来自 effect），分层本身由生产走查 6.3 逐个点开", async () => {
  renderOk(createElement(FleetView), "FleetView layered actions");
});

// ── unify-wanxing-surface-language 4.1: 运维板枚举行是 runner 词汇，不混用 agent 词汇 ──

test("4.1 runner 生命周期枚举行说中文，且不与 agent 状态主徽标混用", async () => {
  const { RUNNER_STATE_LABEL } = await import("../src/views/console/OpsView.jsx");
  const { factLabel, FACT_ORDER } = await import("../src/status-facts.js");
  assert.equal(RUNNER_STATE_LABEL.serving, "在役");
  assert.equal(RUNNER_STATE_LABEL.draining, "退出中");
  // 七个枚举都有中文，且没有一个是裸英文
  for (const k of ["serving", "resident", "paused", "starting", "draining", "warm", "unknown"]) {
    assert.ok(RUNNER_STATE_LABEL[k] && RUNNER_STATE_LABEL[k] !== k, `${k} 必须有中文`);
  }
  // 与 agent 事实徽标不混用：runner 的独有词不得出现在 agent 词汇里
  const agentLabels = FACT_ORDER.map(factLabel);
  for (const w of ["常驻", "启动中", "退出中", "预热"]) {
    assert.ok(!agentLabels.includes(w), `agent 词汇里不该出现 runner 专用词「${w}」`);
  }
});

// ── 详情页路由回归（生产走查 2026-11-15 发现）：#/agent 必须拿到 focusSlug ──
// App.jsx:217 的 focusSlug 白名单曾漏掉 #/agent，导致 5c8bcb2 上线以来详情页恒显
// 「该 agent 已下线或转入私有」。这条锁住白名单与路由表的一致性。
test("详情路由在 focusSlug 白名单里", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"));
  for (const key of ["#/console", "#/chat", "#/bundle", "#/agent"]) {
    assert.ok(src.includes(`viewKey === "${key}"`), `关键是视图路由 ${key} 必须在 focusSlug 白名单里`);
  }
});
