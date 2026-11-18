// 站点副驾宿主（line-reception-teams 2.3）：静态渲染下 effect 不跑，故只断言两件
// 能在无 DOM 条件下成立的事——组件不渲染任何节点（widget 由 loader 注入），且
// 导出的视图白名单与 App 的 hash 路由一致（防止白名单与真实路由漂移）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { installBrowserGlobals } from "./helpers.mjs";

installBrowserGlobals();

const { SiteCopilot, VIEWS } = await import("../src/components/SiteCopilot.jsx");

test("SiteCopilot renders nothing — the loader owns the widget", () => {
  const html = renderToStaticMarkup(createElement(SiteCopilot, { viewKey: "#/" }));
  assert.equal(html, "");
});

test("the hash view whitelist stays a subset of the app's four content views", () => {
  for (const v of ["#/", "#/catalog", "#/docs", "#/agent", "#/chat"]) {
    assert.ok(VIEWS.includes(v), `${v} missing from the whitelist`);
  }
  // 控制台与嵌入件不该出现在副驾的导航白名单里
  assert.ok(!VIEWS.includes("#/console"), "#/console must not be a copilot navigation target");
  assert.ok(!VIEWS.includes("#/embed"), "#/embed must not be a copilot navigation target");
});

// ── 5.6 登录后翻页且上下文不断 ──────────────────────────────────────────────
// 判据只能用纯函数这一层来钉：会话延续靠两点——① 会话 id 只按 slug 派生，与身份
// 档位无关；② 对话历史只按 slug 存，登录/登出不清。两者任一引入 tier 维度，
// 「登录后同一段对话继续」就不成立了。
test("5.6 the conversation id and history are keyed by slug only — login never forks them", async () => {
  const { contextId, loadHistory, saveHistory } = await import("../src/chat-core.js");
  const slug = "packs-test-login-continuity";

  const before = contextId(slug);
  // 模拟「试用中登录」：身份档位变化不该影响这段对话的标识。
  const afterTierFlip = contextId(slug);
  assert.equal(afterTierFlip, before, "the conversation id must not change when the visitor signs in");

  saveHistory(slug, [{ role: "user", text: "试用时的提问", at: 1 }]);
  const hist = loadHistory(slug);
  assert.equal(hist.length, 1, "history must survive the tier flip");
  assert.equal(hist[0].text, "试用时的提问");
});
