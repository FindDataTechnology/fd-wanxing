# Proposal: add-embed-copilot-lane

## Why

各产品线（柏讯/识律/谦面…）想要「壹座副驾」式的悬浮对话助手，但它们没有也不该有壹座的运行时；萬星已能把 agent 部署成服务并给访客整页对话门面，可那要求登录、无上下文感知、不可嵌入——离「一行 iframe 嵌进产品线网页就能用」还差三步：可嵌入的 widget 形态、零摩擦的匿名起步、宿主页上下文摄入。壹座侧 CopilotDock（同源 iframe + 上下文随 URL/postMessage）已验证此形态，本 change 把它搬出壹座、落在萬星门面上。

## What Changes

- **嵌入车道（embed lane）**：`wanxing-web` 新增 `#/embed/:slug` 可嵌入 widget 视图——FAB + 右侧 dock 形态、URL 参数携带 slug/主题/允许嵌入源；跨站 iframe 直连本域 API（nginx 已 `proxy_buffering off`，SSE 无碍）。产品线接入 = 一行 `<iframe>` + 可选宿主片段。
- **身份阶梯（对既有对话车道的进入面扩展）**：
  - **L0 匿名（新增）**：widget 首帧向门面铸短期签名 ephemeral token（浏览器随机 ID）；匿名走**独立更紧的日额**（不复用登录访客的补贴分钟数）；**agent 级匿名开关**（部署者可对自己线关匿名，默认值设计定）。防滥用先接受「清存储重刷」（日额封顶损失），IP 绑定/验证码看滥用数据再议。
  - **L1 登录（两种新进入姿势，车道内核不动）**：①宿主递 token——`verifyVisitor` 增加共享 Logto 租户的 client_id/audience 允许列表，识律式已持客户端 ID token 的产品线零新车道；②popup PKCE 兜底——BFF/cookie 型线（柏讯）在 iframe 内弹 `window.open` 走既有登录，token 经 `window.opener.postMessage` 回交（存储分区：popup 写顶级域未分区 storage，iframe 读按嵌入站分区桶，必须显式回交），widget 自带分区凭据管理，不复用 console auth 的跨分区 `storage` 事件同步。
- **上下文摄入（E2）**：宿主片段经 postMessage 推页面上下文（当前页/实体/意图），widget 以 prompt 前缀注入首回合，上下文条如实展示已发送内容；origin 双向校验。

### Non-goals

- **操控面（E3，第二个 change）**：`ui_intent` 宿主动作（导航/高亮/预填/刷新）、问询卡经 chat lane 下发与答题路由、runner 侧 user-questions provider 移植（paas 仓 `agent-runner`，桥机制与 `request()` 深控车道已在，属移植非新建）。
- 工具卡/思维链渲染增强（`textOfFrame` 现状纯文本；先实锤 runner 流携带形状，随 E3 一并议）。
- 匿名 IP 绑定 / turnstile（看滥用数据再议）。
- 产品线代传身份之外的新集成车道（BFF 线一律 popup 兜底）。
- 壹座内 CopilotDock 与本 widget 的代码收敛（两个宿主形态各自演进）。

## Capabilities

### New Capabilities

（无——嵌入车道照 add-agent-chat-lane 先例，落在两个既有能力的增量里）

### Modified Capabilities

- `wanxing-facade`: 访客凭据形状扩展（`verifyVisitor` 认 ephemeral 匿名 token 与多 aud 的宿主递 ID token）、ephemeral 铸发端点、独立匿名日额记账（按 ephemeral ID × 日窗）、agent 级匿名开关进入 chatability 判定、嵌入源允许列表。
- `wanxing-web`: 新增 `#/embed/:slug` 视图（FAB/dock、主题参数、上下文条）、分区凭据管理 + popup 回交 + 「登录升级」常驻、postMessage 上下文摄入（origin 双向校验）。

## Impact

- **services/wanxing-facade**：`chat.js` `verifyVisitor` 是唯一身份切口（下游 RPM/槽/幂等/记账/结算瀑布全按 `visitorSub` 参数化，匿名零下游改动）；`store` 增匿名日额表；`selfservice.js` `chatVerdict` 加匿名开关分支；新 ephemeral 铸发路由。
- **wanxing-web**：新 EmbedView（不复用 console auth 的凭据管理，分区感知自带一套）；postMessage intake 协议（宿主→widget 上下文、widget↔popup token 回交）。
- **试点接入**：识律 web（已持共享租户客户端 ID token，`fd-lex/web/src/console/auth.ts`）——宿主片段约两行 + context pusher，作为真机验收面。
- **部署**：facade 新 env（匿名全局开关/匿名日额分钟/允许 aud 列表/允许嵌入源）；web 无新依赖。
- **词汇**：CONTEXT.md 增补「匿名访客（ephemeral visitor）」「嵌入车道（embed lane）」词条，沿用既有「访客/对话车道/结算方」词族。
