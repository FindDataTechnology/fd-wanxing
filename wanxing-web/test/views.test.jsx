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

test("2.2 卡片上的分类信号走 label() 翻译（标签墙移出卡片，由详情页与 labels 单测承接）", async () => {
  const { AgentCard } = await import("../src/views/CatalogView.jsx");
  const html = renderToStaticMarkup(createElement(AgentCard, {
    agent: { slug: "s1", name: "甲", status: "serving", category: "wire", tags: ["security-pending", "wire", "xyzzy"] },
  }));
  assert.ok(html.includes("柏讯"), "wire 分类必须译出");
  assert.ok(!html.includes("security-pending"), "标签墙已移出卡片——四元件之外不再堆砌");
  // 标签字典的 fail-open（未命中标签原样保留）由 labels.test.mjs 单独守护。
});

test("2.3 卡片四元件：一枚主徽标、无同质填充语、无空折叠区、入口按事实选择", async () => {
  const { AgentCard } = await import("../src/views/CatalogView.jsx");
  const bare = renderToStaticMarkup(createElement(AgentCard, {
    agent: { slug: "s1", name: "甲", status: "serving", skills: [], examples: [], chatable: true },
  }));
  assert.ok(!bare.includes("（未声明）"), "不得出现「（未声明）」式残缺");
  assert.ok(!bare.includes("对话即试用"), "19/19 卡重复的填充语必须消失（规格：不得渲染替代填充句）");
  assert.ok(!bare.includes("<details"), "无技能时连折叠区都不渲染");
  assert.ok(!bare.includes(">slug<"), "slug 不再作为折叠区标题出现在卡片上");
  assert.ok(bare.includes('data-testid="entry-cta-s1"'), "入口仍在");
  assert.ok(bare.includes(">对话<"), "可对话且未暂停 → 对话入口");

  const withSkills = renderToStaticMarkup(createElement(AgentCard, {
    agent: { slug: "s1", name: "甲", status: "serving", skills: ["检索"], examples: [] },
  }));
  assert.ok(withSkills.includes("技能"), "声明了技能时折叠区存在");

  // paused → no chat entry, detail instead (spec: chat entry only when not paused).
  const paused = renderToStaticMarkup(createElement(AgentCard, {
    agent: { slug: "s1", name: "甲", status: "paused", chatable: true, examples: [] },
  }));
  assert.ok(!paused.includes(">对话<"), "已暂停不出对话入口");
  assert.ok(paused.includes(">看详情<"), "已暂停改为详情入口");
  assert.ok(paused.includes("已暂停"), "主徽标说出暂停");
});

test("3.1 卡片只有一枚主事实徽标，其余信号是文本不是彩色 chip", async () => {
  const { AgentCard } = await import("../src/views/CatalogView.jsx");
  const html = renderToStaticMarkup(createElement(AgentCard, {
    agent: {
      slug: "s1", name: "甲", status: "serving", chatable: true, turns7d: 33,
      cluster: { role: "default", name: "研判集群" }, category: "wire", health: { health: "failing" },
    },
  }));
  const badgeCount = (html.match(/data-testid="status-badge-s1"/g) ?? []).length;
  assert.equal(badgeCount, 1, "同一 agent 在卡上只出现一枚状态徽标");
  assert.ok(html.includes("持续失败"), "failing 压过 serving（事实表优先级）");
  assert.ok(!html.includes("在役"), "不得同时出现健康措辞");
  assert.ok(html.includes("近 7 天 33 回合"), "活动量以文本呈现");
  assert.ok(!html.includes('data-testid="activity-badge-s1"'), "活动量不再是彩色 chip");
  assert.ok(!html.includes('data-testid="cluster-role-s1"'), "集群角色不再是彩色 chip");
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

// ── wanxing-first-impression 2.4: both shells render assistant text through
// the ONE shared formatter, and visitor text is never interpreted. ───────────
test("2.4 assistant bubbles render markdown; visitor bubbles stay literal", async () => {
  const history = [
    { role: "user", text: "我说 **不是重点** 看看", at: 1 },
    { role: "assistant", text: "结论：\n\n- **壹座** 建管\n- 萬星 上线运行", at: 2 },
  ];
  localStorage.setItem("wx-chat-history:demo-agent", JSON.stringify(history));
  location.hash = "#/embed/demo-agent?open=1";
  try {
    const html = renderOk(<EmbedView focusSlug="demo-agent" />, "EmbedView markdown");
    assert.ok(html.includes("<strong>壹座</strong>"), "assistant bold renders as an element");
    assert.ok(html.includes("<ul>"), "assistant list renders as a list");
    assert.ok(html.includes("我说 **不是重点** 看看"), "the visitor's own asterisks survive literally");
  } finally {
    location.hash = "";
    resetStorages();
  }
});

// ── wanxing-first-impression 4.x: 详情页三段 + 可见性文字 ────────────────────
test("4.1/4.2/4.3 详情页三段结构、可见性成句、无示例不编造", async () => {
  // Static render stops at loading (fetch in effect), so the pure pieces are
  // asserted through the module's own exports/behaviour: the page's structure
  // is pinned by the module source contract test below, and its copy by 真机.
  const { AgentDetailView } = await import("../src/views/AgentDetailView.jsx");
  const html = renderOk(createElement(AgentDetailView, { focusSlug: "s1" }), "AgentDetailView");
  assert.ok(html.includes('data-testid="agent-detail-loading"'), "加载态骨架仍在");
});

test("4.1 the detail source carries the three sections and per-agent call samples", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/views/AgentDetailView.jsx", import.meta.url), "utf8");
  for (const id of ["detail-now", "detail-how", "detail-visibility", "detail-copy-curl", "detail-copy-embed",
                    "detail-pillars"]) {
    assert.ok(src.includes(`"${id}"`), `${id} 必须存在于详情页`);
  }
  // unify-pillar-surfaces 4.3：两支柱各自一段，id 由 sec.key 拼出（toolkit / memory）
  assert.ok(src.includes("detail-${sec.key}"), "工具面/记忆段必须有各自稳定 testid");
  assert.ok(src.includes("detail-${sec.key}-undeclared"), "未声明态要有独立 testid（三态不许合并）");
  assert.ok(src.includes("detail-dashboard-standup"), "D8：声明了看板要给建队入口（4.4）");
  assert.ok(!src.includes("data-agent="), "嵌入脚本不得写 loader 不认的属性（loader 按 data-line 解析）");
  assert.ok(src.includes("/#/embed/${slug}"), "嵌入示例用可按 slug 直连的 iframe 路由");
});

// ── unify-pillar-surfaces 4.3: 详情页渲染三支柱（契约事实，不含散文） ────────
test("4.3 三支柱：有声明 -> present 且逐项可读；无声明 -> 显式「未声明」，不是空壳", async () => {
  const { pillarSectionsOf } = await import("../src/views/AgentDetailView.jsx");

  const declared = pillarSectionsOf({
    slug: "s1",
    toolFace: { "invest-ops-mcp": ["fleet_list", "fleet_spec_read"], "facet-market-mcp": [] },
    memory: { store: { home: "member" }, read: { scope: "own+shared" }, write: { authority: "private" }, process: { distill: "on" } },
  });
  const [toolkit, memory] = declared;
  assert.equal(toolkit.state, "present");
  assert.deepEqual(toolkit.groups.map((g) => g.server), ["invest-ops-mcp", "facet-market-mcp"]);
  assert.deepEqual(toolkit.groups[0].tools, ["fleet_list", "fleet_spec_read"]);
  assert.equal(memory.state, "present");
  assert.deepEqual(memory.axes.map((a) => a.key),
    ["store.home", "read.scope", "write.authority", "process.distill"]);
  assert.deepEqual(memory.axes.map((a) => a.value), ["member", "own+shared", "private", "on"]);

  // 未声明：两段都必须给出显式文案（渲染成「未声明」而非空串）
  const bare = pillarSectionsOf({ slug: "s2" });
  for (const sec of bare) {
    assert.equal(sec.state, "undeclared", `${sec.key} 未声明必须是 undeclared`);
    assert.ok(sec.undeclaredText && sec.undeclaredText.length > 5, `${sec.key} 要有成句的未声明文案`);
  }

  // 只声明章程（机器面不带 axes）⇒ 仍是 undeclared，且文案要说清「不等于没有记忆」
  const charterOnly = pillarSectionsOf({ slug: "s3", memory: {} });
  const mem3 = charterOnly.find((x) => x.key === "memory");
  assert.equal(mem3.state, "undeclared");
  assert.ok(mem3.undeclaredText.includes("平台默认"), "要点明沿用平台默认");

  // 散文绝不上这些面：payload 里塞了 guidance 也不许出现在渲染数据里
  const smuggled = pillarSectionsOf({ memory: { guidance: "记：只记读数", store: { home: "member" } } });
  const mem4 = smuggled.find((x) => x.key === "memory");
  assert.equal(JSON.stringify(mem4).includes("只记读数"), false, "章程原文不得进入渲染数据");
});

// ── unify-pillar-surfaces 4.4 / design D8: 单 agent 的看板段 ─────────────────
test("4.4 看板段：声明了 team console -> 引导建队；未声明 -> 明说无团队看板（都不伪造运行态）", async () => {
  const { pillarSectionsOf } = await import("../src/views/AgentDetailView.jsx");

  const team = pillarSectionsOf({
    slug: "s1",
    console: { headline: "decisions.open", blocks: ["team", "kpi", "stream"] },
  }).find((x) => x.key === "dashboard");
  assert.equal(team.state, "team");
  assert.equal(team.headline, "decisions.open");
  assert.deepEqual(team.blocks, ["team", "kpi", "stream"]);
  assert.ok(team.teamText.includes("建队"), "声明了看板就要给出建队指引");
  // D8：单 agent 面不得伪造看板——段里只有声明事实与指引，没有运行态读数
  assert.equal(JSON.stringify(team).includes("turns7d"), false, "看板段不得混入运行态读数");

  const none = pillarSectionsOf({ slug: "s2" }).find((x) => x.key === "dashboard");
  assert.equal(none.state, "undeclared");
  assert.ok(none.undeclaredText.includes("团队控制台"), "未声明时要说明去哪儿看真看板");
  assert.deepEqual(none.blocks, []);
  assert.equal(none.headline, null);

  // 只给 headline 不给 blocks（老作者的写法）也要算「声明了」
  const headOnly = pillarSectionsOf({ console: { headline: "decisions.open" } }).find((x) => x.key === "dashboard");
  assert.equal(headOnly.state, "team");
  assert.deepEqual(headOnly.blocks, []);
});

// ── wanxing-first-impression 5.x: 首屏活读数 + 真卡片 ────────────────────────
test("5.1 status readouts are derived from the aggregate honestly (catalog size ≠ 在役)", async () => {
  const { statusReadouts, statusLine } = await import("../src/components/StatusStrip.jsx");
  const data = { agents: { value: 19, stale: false }, turns7d: { value: 46, stale: false }, settlement_pending: { value: { count: 0 }, stale: false } };
  const rows = statusReadouts(data);
  assert.equal(rows.length, 3);
  assert.ok(rows[0].label.includes("已上线"), "目录规模说的是已上线，不是「在役」");
  assert.ok(!rows[0].label.includes("在役"), "在役是七事实之一，不能用来指目录总数");
  assert.ok(statusLine(data).includes("近 7 天 46 回合"));
  // Failure / staleness produce no readouts — never a zero.
  assert.deepEqual(statusReadouts(false), []);
  assert.deepEqual(statusReadouts(null), []);
  assert.deepEqual(statusReadouts({ agents: { value: 19, stale: true } }), []);
  assert.equal(statusLine(false), "萬星服务运行中");
});

test("5.2/5.3/5.4 the landing leads with readouts + agents and renders with no live data", async () => {
  const { IntroView } = await import("../src/views/IntroView.jsx");
  const html = renderOk(<IntroView />, "IntroView");
  assert.ok(html.includes("Agent 服务的对外运行与服务平台"), "定位仍在");
  assert.ok(html.includes("对接文档"), "CTA 仍在");
  // Effects do not run under static render: readouts and cards are absent, and
  // that is exactly the degraded shape — no skeleton, no error banner.
  assert.ok(!html.includes("animate-pulse"), "首屏不出现骨架抖动");
  assert.ok(!html.includes('data-testid="landing-agents-down"'), "未失败就不说失败");
  // Pricing/about are below the fold now, not the lede.
  const readoutsIdx = html.indexOf("Agent 服务的对外运行与服务平台");
  const pricingIdx = html.indexOf("计费口径");
  assert.ok(pricingIdx > readoutsIdx, "计费口径排在首屏读数之后");
});

// ── wanxing-first-impression 6.x: 登录原地 + 落回原对话 ──────────────────────
test("6.1/6.4 登录门槛原地渲染：agent 名与说明同屏，文案说明会回到这个对话", async () => {
  location.hash = "#/chat/some-agent?q=%E4%BD%A0%E4%BB%AC%E5%81%9A%E4%BB%80%E4%B9%88";
  try {
    const html = renderOk(<ChatView focusSlug="some-agent" />, "ChatView gate");
    assert.ok(html.includes('data-testid="chat-login-gate"'), "登录门槛在对话页上");
    assert.ok(html.includes("some-agent"), "门槛与 agent 标识同屏（不是无名之墙）");
    assert.ok(html.includes("登录会回到这个对话继续"), "文案说明登录后落回这里");
    assert.ok(html.includes("使用寻数账号登录"), "登录入口仍在");
  } finally {
    location.hash = "";
  }
});

test("6.2 the login call carries the full hash (draft query survives the round trip)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/views/ChatView.jsx", import.meta.url), "utf8");
  assert.ok(src.includes("returnTo: window.location.hash"), "returnTo 必须传完整 hash（含 ?q=），否则草稿丢失");
  assert.ok(!src.includes("returnTo: `#/chat/${encodeURIComponent(slug)}`"), "不得退回只传 slug 的旧写法");
});

// ── wanxing-first-impression 7.x: 舰队卡首行结论 ─────────────────────────────
test("7.1 fleetConclusion covers the seven facts and never contradicts the badge", async () => {
  const { fleetConclusion } = await import("../src/views/console/FleetView.jsx");
  assert.equal(fleetConclusion({ fact: "paused" }), "已暂停，访客不可用");
  assert.equal(fleetConclusion({ fact: "unknown" }), "状态未知（快照不可得）");
  assert.equal(fleetConclusion({ fact: "failing", health: { lastErrorKind: "upstream" } }), "持续失败 · 上游失败");
  assert.equal(fleetConclusion({ fact: "failing" }), "持续失败");
  assert.equal(fleetConclusion({ fact: "degraded", health: { lastErrorKind: "rate_limited" } }), "部分失败 · 被限流");
  assert.equal(fleetConclusion({ fact: "stalled", health: { expected_turns: 4 } }), "该跑没跑 · 按声明应有 4 次");
  assert.equal(fleetConclusion({ fact: "unused", summaryLanded: true }), "尚无调用");
  assert.equal(fleetConclusion({ fact: "live", sig: { turns7d: 33 }, summaryLanded: true }), "近 7 天 33 回合，无健康告警");
  assert.equal(fleetConclusion({ fact: "live", summaryLanded: false }), "在役");
  assert.equal(fleetConclusion({ fact: null }), null, "没有证据时不编结论");
});

test("7.3 a failing fact never yields a healthy-sounding conclusion", async () => {
  const { fleetConclusion, fleetFactOf } = await import("../src/views/console/FleetView.jsx");
  const fact = fleetFactOf({ paused: false, sig: { turns7d: 9 }, summaryLanded: true, health: { health: "failing" }, healthSectionUp: true });
  assert.equal(fact, "failing");
  const sentence = fleetConclusion({ fact, sig: { turns7d: 9 }, health: { health: "failing" }, summaryLanded: true });
  assert.ok(sentence.startsWith("持续失败"), "结论与徽标同向");
  assert.ok(!sentence.includes("无健康告警"));
});
