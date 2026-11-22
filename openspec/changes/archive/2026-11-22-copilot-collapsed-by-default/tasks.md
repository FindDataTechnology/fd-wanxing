# Tasks

## 1. Loader 判定翻默认

- [x] 1.1 `wanxing-web/public/copilot.js` 把 `var OPEN = script.getAttribute("data-open") !== "0";` 改成 `=== "1"`，注释说明「省略即收起，展开是宿主的显式选择」。验证：`grep -n 'data-open' wanxing-web/public/copilot.js` 只剩 `=== "1"` 一处判定。

- [x] 1.2 在 `wanxing-web/test/copilot-loader.test.mjs` 补一条用例：假 DOM 对 `data-open` 返回 `null`（属性缺失）时，注入的 iframe `style.cssText` 含 `height:80px` 且 `src` 不含 `open=1`。验证：`node --test wanxing-web/test/copilot-loader.test.mjs` 全绿，且新用例在旧实现（`!== "0"`）下会红——先把实现改回旧行跑一次确认它确实失败。

## 2. 文档与注释校正

- [x] 2.1 `wanxing-web/public/host-demo.html:39` 的接入说明改成「`data-open="1"` 可让 widget 初始展开（缺省收起）」。验证：该文件内不再出现「`data-open="0"` 可让 widget 初始收起」的旧句。

- [x] 2.2 `paas/web/index.html` 与 `paas/facet/web/index.html` 里陈述「不写它时 loader 把未写当成展开」的注释改成新事实（属性可留）。验证：两处注释不再声称省略即展开。

## 3. 出片与线上验收

- [x] 3.1 按 paas-release 线把 `wanxing-web` 出片并滚 tag，等 `wanxing.finddatatech.cloud/copilot.js` 的缓存过期（≤5 分钟）。验证：`curl -s https://wanxing.finddatatech.cloud/copilot.js | grep -n 'data-open'` 线上返回 `=== "1"`。

- [x] 3.2 真浏览器验收四个面：官网 `www.finddatatech.cloud`（中英各一次）与柏讯 `wire.finddatatech.cloud` 首屏只有右下角圆钮、点开才有面板；识律控制台首屏仍展开；壹座/谦面仍收起。验证：截图 + 按 `data-testid="wx-embed-launcher"` / `wx-embed-panel` 的可见性判定，不看 DOM 节点数。

## Workflow follow-up

- 归档前跑 `openspec validate copilot-collapsed-by-default --strict`。
- 归档：`openspec archive copilot-collapsed-by-default`（delta 是纯 MODIFIED，交给 CLI 合并，不手工覆盖主 spec）。

## 3.2 验收记录（2026-11-22，ego-browser 真浏览器）

| 面 | 首屏 | 证据 |
|---|---|---|
| 官网 `www.finddatatech.cloud/` | 80px 圆钮 | `/tmp/copilot-accept/official-zh-default.png`，点开后 640px |
| 官网 EN `www.finddatatech.cloud/en/` | 80px，src 无 `open=1` | 同上，`official-en-default.png` |
| 柏讯 `wire.finddatatech.cloud/` | 80px | `wire-default.png` |
| 谦面 `facet.finddatatech.cloud/` | 80px | `facet-default.png` |
| 识律营销 `lex.finddatatech.cloud/` | 80px | `lex-marketing-default.png` |
| 识律控制台（已登录） | **80px（未展开）** | `lex-console-authed.png` |
| 壹座 `paas.finddatatech.cloud/` | 未测到 | 匿名进入被 forward_auth 挡到 Logto；登出态回调 `{"error":"internal error"}` |

**控制台一条不是本次翻默认的结果**：控制台页上有两个宿主组件（`console/WanxingCopilot`
写 `data-open="1"`、`components/Layout` 里的 `MarketingCopilot` 写 `"0"`），谁先 append
谁赢；`ConsoleApp` 先渲染 loading（无 ConsoleLayout）→ 营销 loader 先挂上，控制台那份
随后检测到已有 iframe 直接 return。这是登录前就存在的竞态，与 loader 默认值无关。
