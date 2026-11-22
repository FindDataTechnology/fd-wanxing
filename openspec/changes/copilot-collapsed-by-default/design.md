# Design

## Context

跨线副驾只有一份 loader（`wanxing-web/public/copilot.js`），八个宿主都引它。首屏状态由
`data-open` 属性单点决定：

```js
var OPEN = script.getAttribute("data-open") !== "0";   // 省略 → 展开
```

宿主的实际取值分三类：显式 `"0"`（壹座、谦面、识律营销页、萬星站、哲思/实论/剧创/政心）、
显式 `"1"`（识律控制台、host-demo）、以及**没写**（官网、柏讯）。第三类就是现状里
「一进页面一块面板压下来」的那两个站。

约束：loader 由萬星单独出片；官网与柏讯是另外两个服务（官网还有 EdgeOne 300s 缓存）。
`data-open` 没有被 `wanxing-public-api.v1.json` 的 `copilotHost` 契约具名——契约只约束
postMessage 消息集（`test-public-contract.mjs` 按正则数消息类型），所以改首屏默认不触发契约对账红。

## Goals / Non-Goals

**Goals:**

- 「省略即收起」成为 loader 的语义，且由测试守着。
- 已写 `"0"` / `"1"` 的宿主行为零变化。
- 只滚萬星一个服务即可修复官网与柏讯。

**Non-Goals:**

- 不引入第三种 `data-open` 取值（不做「按路由/设备/登录态自动决定」）。
- 不改宿主侧写死的属性，不移除现有 `data-open="0"`。
- 不动直接嵌入路径（`#/embed/<slug>` 的 `open=1` 查询参数），那是按 URL 显式给的。

## Decisions

**1. 翻默认值，而不是修宿主。**

`!== "0"` 改成 `=== "1"`。备选是只给官网/柏讯补 `data-open="0"`——两行、看似更小，但它把
「忘写就弹面板」的坑留在原地：这个坑已经被踩过两次，两次都靠事后补属性 + 抄同一段注释。
改默认是从根上让下一个宿主不必知道这个属性存在。

**2. 属性名与取值不变。**

仍是 `data-open`，仍用 `"1"`/`"0"`。翻默认后 `"0"` 虽冗余但继续被理解（值为 `"0"` 也是收起），
所以没有必须同步出片的宿主；官网/柏讯无需代码变更。

**3. 展开的验证锚在 iframe 尺寸与 src。**

已收起的可观测特征有两条：iframe `height` 是 80px（launcher 高），以及 src 不带 `open=1`。
两条都写在现有 loader 里（`frame.style.cssText` 与 `q.push("open=1")`），测试直接断言这两条，
不新增接口。现有用例的假 DOM 恒返回 `data-open:"1"`，所以新默认加一条独立用例覆盖「属性缺失」。

**4. 文档句与注释同批修正。**

`host-demo.html` 的接入说明、`paas/web/index.html` 与 `paas/facet/web/index.html` 的注释都
在陈述旧事实（「不写就展开」）。它们不是代码逻辑，但留成反话就是下一次误判的素材。

## Risks / Trade-offs

- **工作区外还有按旧文档接入的宿主** → 它们的副驾会变收起（而不是变坏）。收起是安全方向：
  访客仍能点开；不可能出现「本来好好的对话入口消失了」。若真发现某个宿主必须首屏展开，
  给它加 `data-open="1"` 即可，无需回滚 loader。
- **官网 EdgeOne 缓存 300s** → 旧 HTML 里没有 `data-open` 属性，但 loader 是从萬星域实时取的，
  所以缓存只会延迟「HTML 本身」的更新，副驾行为立刻跟新——不存在需要清缓存才生效的情况。
- **`data-wanxing-copilot` iframe 的 80px 高度语义** → 收起态若被宿主 CSS 覆盖可能吃掉一角点击；
  现状已由 `wx-copilot-state` 消息把高度同步下来，本次不改这条通路。

## Migration Plan

1. 改 loader 判定 + 补测试 + 修正文档句，在 `fd-wanxing` 内跑 loader 测试。
2. 萬星 web 出片并滚 tag（`wanxing.finddatatech.cloud/copilot.js` 的 `Cache-Control` 是 300s，
   最迟 5 分钟后所有宿主拿到新 loader）。
3. 验收：打开官网与柏讯线上页，确认首屏只有右下角圆钮、点开才有面板；识律控制台首屏仍是展开。

回滚：把判定改回 `!== "0"` 再出片一次；没有数据或状态需要迁移。
