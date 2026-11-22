# Tasks

## 1. Loader 判定翻默认

- [x] 1.1 `wanxing-web/public/copilot.js` 把 `var OPEN = script.getAttribute("data-open") !== "0";` 改成 `=== "1"`，注释说明「省略即收起，展开是宿主的显式选择」。验证：`grep -n 'data-open' wanxing-web/public/copilot.js` 只剩 `=== "1"` 一处判定。

- [x] 1.2 在 `wanxing-web/test/copilot-loader.test.mjs` 补一条用例：假 DOM 对 `data-open` 返回 `null`（属性缺失）时，注入的 iframe `style.cssText` 含 `height:80px` 且 `src` 不含 `open=1`。验证：`node --test wanxing-web/test/copilot-loader.test.mjs` 全绿，且新用例在旧实现（`!== "0"`）下会红——先把实现改回旧行跑一次确认它确实失败。

## 2. 文档与注释校正

- [x] 2.1 `wanxing-web/public/host-demo.html:39` 的接入说明改成「`data-open="1"` 可让 widget 初始展开（缺省收起）」。验证：该文件内不再出现「`data-open="0"` 可让 widget 初始收起」的旧句。

- [x] 2.2 `paas/web/index.html` 与 `paas/facet/web/index.html` 里陈述「不写它时 loader 把未写当成展开」的注释改成新事实（属性可留）。验证：两处注释不再声称省略即展开。

## 3. 出片与线上验收

- [ ] 3.1 按 paas-release 线把 `wanxing-web` 出片并滚 tag，等 `wanxing.finddatatech.cloud/copilot.js` 的缓存过期（≤5 分钟）。验证：`curl -s https://wanxing.finddatatech.cloud/copilot.js | grep -n 'data-open'` 线上返回 `=== "1"`。

- [ ] 3.2 真浏览器验收四个面：官网 `www.finddatatech.cloud`（中英各一次）与柏讯 `wire.finddatatech.cloud` 首屏只有右下角圆钮、点开才有面板；识律控制台首屏仍展开；壹座/谦面仍收起。验证：截图 + 按 `data-testid="wx-embed-launcher"` / `wx-embed-panel` 的可见性判定，不看 DOM 节点数。

## Workflow follow-up

- 归档前跑 `openspec validate copilot-collapsed-by-default --strict`。
- 归档：`openspec archive copilot-collapsed-by-default`（delta 是纯 MODIFIED，交给 CLI 合并，不手工覆盖主 spec）。
