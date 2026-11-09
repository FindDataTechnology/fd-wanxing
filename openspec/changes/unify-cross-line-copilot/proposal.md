# 跨线副驾接入统一（unify-cross-line-copilot）

## Why

萬星已经建成了完整的跨站嵌入车道（身份三级阶梯、匿名双门、问询卡、宿主意图），但**它只被一条线用上过一次**：识律控制台硬编码了一个部署 slug 并手写了 124 行宿主协议（`fd-lex/web/src/console/WanxingCopilot.tsx:21`），官网、营销站、柏讯对外面零挂载。原因是接入成本与默认状态，不是能力缺失——五线每接一条要写协议片段 + 配 audience 白名单 + 决定匿名 + 拿到 slug，而匿名默认是关的，贴上去的访客第一眼看到的是「登录后开始对话」，登录还跳到另一个产品。

同时站内出现了第二套副驾：壹座 `CopilotDock` 用同源 iframe + 形状解析的聚焦预设（`paas/lib/copilot-presets.js`），与萬星的跨站 widget 在身份、结算、上下文协议、动作能力上全不兼容；萬星站内 `#/chat` 与 `#/embed` 又是两份并行聊天实现，连历史/上下文/自带键的存储键名都各写一套，问询卡只有 embed 侧渲染。

结果：同一个产品角色（「这条线的副驾」）在用户面前是三张脸、两种协议、零共享代码。跨线接入因此永远停留在试点。

## What Changes

**① 副驾绑定成为萬星自有的治理面（不再是源码常量）**
- 新增线→部署的绑定声明（`line → agent slug` + accent + 匿名策略），存在萬星平面自己的库，不写兄弟线的部署台账（借用契约只读）。
- 新增公开只读解析端点 `GET /api/wanxing/v1/lines/:line/copilot`（CORS `*`，仅返回公开信息），未绑定/已暂停时返回显式 `state`，让宿主机决定降级，而不是渲染一张死卡。
- 控制台加 ops 级「线副驾」面板（谁绑定、绑定到哪、可解绑），绑定时校验 slug 在部署台账里真实存在。

**② 接入压成一行 `<script>`**
- `copilot.js` loader（自托管静态文件）：读 `data-line` → 解析绑定 → 插 iframe → **由 loader 自己跑完整宿主协议**（init/context/identity/intent）→ 暴露 `identify()` / `context()` / `intents` 三个可选钩子。
- 宿主不再手写 postMessage 协议；识律那 124 行塌成 1 个 script 标签 + 一个身份钩子。
- 无绑定、助手暂停、配置缺失时 loader **不注入**（并 console 记一次原因），页面不留死卡。

**③ 匿名与登录出口按线定，不按全局开关**
- 绑定声明携带 `anonymous` 策略；公开站点线默认允许匿名，控制台内线默认不允许。
- 登录升级优先走**宿主自己的身份**（loader 的 `identify()` 返回宿主票，audience 白名单在萬星侧），宿主没有身份时才落萬星 popup 登录，并在文案里说清是登录到哪。

**④ 两个聊天核合一**
- 抽出 shared chat core：历史持久化、上下文 id、自带键桥、文本渲染、SSE 事件分发、**问询卡与意图**。
- `ChatView` 与 `EmbedView` 退化为身份外壳；站内对话页同样渲染问询卡（今天它忽略 `ask` 帧）。
- 存储键迁移：老键读一次、写新键，不丢既有本机历史。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wanxing-facade`：新增线副驾绑定（存储 + 公开只读解析端点 + 显式未绑定/暂停状态 + CORS 口径），并规定绑定只能指向部署台账里真实存在的公开 agent。
- `wanxing-web`：新增 `copilot.js` loader 的一行接入契约与降级行为；控制台新增线副驾面板；嵌入车道的匿名/登录出口按绑定声明；`#/chat` 与 `#/embed` 共用一套聊天核（含问询卡与宿主意图），历史存储键迁移。

## Non-goals

- **不统一两条副驾的「助手来源」**：站内（壹座 `CopilotDock`）继续按形状解析已装 pack，对外（萬星）继续按显式绑定。两条线回答的是不同问题——「这个 cell 里装了什么」vs「这条线对外用哪一个」，强行合一会让公开面依赖某个 cell 的安装状态。此裁决记入 design。
- 不把壹座 `CopilotDock` 迁到萬星门面（否决理由见 design 的备选方案）。
- 不改 A2A 协议、计费口径、身份阶梯本身；不新增计费能力。
- 不做匿名反滥用强化（清存储重刷仍是接受的已知口子，维持 ADR-0003 裁决）。
- 不新增多副驾并存（一条线一个对外副驾；`state` 里保留扩展位）。

## Impact

**代码**
- `services/wanxing-facade/`：`store.js` 新表 + 存取；`routes.js`/新模块挂公开解析端点与 CORS；`console.js` 线副驾面板的读写端点（ops 与 owner 分权）。
- `wanxing-web/`：`public/copilot.js`（新）；`src/views/ChatView.jsx` 与 `src/views/EmbedView.jsx` 抽出 shared core（`src/chat-core.js` 或同层模块）；`src/views/console/FleetView.jsx` 或新 ops 面板；`src/views/DocsView.jsx` + `public/host-demo.html` 改写成 loader 示例。
- `fd-lex/web/src/console/WanxingCopilot.tsx`（**跨仓**）：124 行宿主片段收成 loader 一行 + identity 钩子；`WIDGET_SLUG` 常量删除。
- `paas/` 不改（绑定不写部署台账）。

**契约与运维**
- 新公开端点需要 CORS 与缓存头（nginx 在 `wanxing-web/nginx.conf`，静态文件走 `/`）。
- `copilot.js` 需要版本化 URL 或短缓存，避免宿主拿到旧 loader。
- 绑定变更立即生效（loader 每次加载都解析一次绑定，不缓存到构建期）。

**风险**
- 识律是唯一在产消费者，改造期间必须保持其副驾可用：loader 先与旧片段并存，切换后删除旧码。
- 公开端点泄露 slug 属可接受（目录本就公开），但不得返回结算方、配额余量、部署者邮箱。
