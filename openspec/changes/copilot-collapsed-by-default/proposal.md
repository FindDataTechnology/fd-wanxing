# Proposal

## Why

跨线副驾 loader 把「没写 `data-open`」当成展开（`copilot.js:40` 的
`getAttribute("data-open") !== "0"`），于是任何宿主漏写这个属性，访客一进页面就被一块
420×640 的面板压在右下角（z-index 2147483000）。这个坑已经踩了两次：壹座与谦面的宿主
都是事后补 `data-open="0"` 并附一段解释性注释——注释写了两遍，说明默认值本身是错的。

对外页面的默认语义应当是「不打扰」：副驾存在，但不主动展开。

## What Changes

- loader 的展开判定翻成显式开启：只有 `data-open="1"` 才首屏展开，**省略即收起**（只剩 48px 圆钮）。
  这是行为变更，但**不是**对宿主的破坏性变更——已写 `data-open="0"` 的宿主行为完全不变，
  写 `"1"` 的（识律控制台、host-demo）也不变；只有「什么都没写」的宿主从展开变收起，
  而那正是本次要修的形态。
- 官网（`fd-official-web/src/components/Layout.astro`）与柏讯（`fd-wire/web/index.html`）
  两个曾经依赖「省略=展开」的宿主**不改代码**，随 loader 一起变收起。它们的仓不需要出片。
- 补一条 loader 测试：不写 `data-open` 时 iframe 首屏 80px 且 src 不带 `open=1`。
  现有用例的假 DOM 恒返回 `"1"`，新默认此前没有任何东西守着。
- 文档与注释校正：`host-demo.html` 的接入说明、`paas/web/index.html` 与
  `paas/facet/web/index.html` 里已经说谎的注释（仍写着「不写就展开」）。

Non-goals:

- 不加新参数（`data-open="auto"`、按设备/路由决定首屏状态都不做）。
- 不动 Chatwoot 客服气泡（`desk.finddatatech.cloud`），那是另一条接待链路，一直是收起的。
- 不回收官网/柏讯那两行 `data-open="0"`——属性留着无害，删它只会多滚两个服务。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-web`: 「A loader script mounts a line's copilot in one tag」这条要求补上首屏默认态的
  语义——loader 的初始展开是显式选择，省略即收起；并补一个对应 scenario。

## Impact

- 代码：`fd-wanxing/wanxing-web/public/copilot.js`（一行判定）、
  `wanxing-web/test/copilot-loader.test.mjs`（补用例）、`wanxing-web/public/host-demo.html`（文档句）。
- 出片：只滚萬星一个服务。官网与柏讯不重新出片；官网 EdgeOne 有 300s 缓存，旧 HTML 同样受益。
- 外部宿主：若工作区之外有页面按旧文档「省略=开」接入，其副驾会变收起——这正是新默认想要的结果，
  但需要知道它发生了。
- 协议面：`wx-copilot-*` 消息集与契约 `copilotHost` 不变；契约对账测试（`test-public-contract.mjs`）
  只数消息类型，不受影响。