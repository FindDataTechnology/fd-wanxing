# 设计：跨线副驾接入统一

## Context

现网有两套「线内副驾」，见 proposal.md 的 Why。设计必须同时容纳的事实：

- **萬星侧**：`EmbedView` 是完整的跨站 widget（三级身份、问询卡、意图信封），协议由宿主实现（识律 `WanxingCopilot.tsx` 124 行）；副驾是哪个 agent 只能写死在宿主源码里（`WIDGET_SLUG`）。部署台账来自兄弟线 `packs internal API`，行内只有 `agentPath/packId/agentId/version/deployedBy`，**没有任何「线」字段**；`category` 是策展分类（`fleet`/`wire`/`facet`），不是五线归属（`paas/lib/pack-manifest.js:1605`）。
- **壹座侧**：`CopilotDock` 用同源 iframe 装 `/chat?embed=copilot&board=<line>&preset=<id>`，助手来源是**形状解析**（`paas/lib/copilot-presets.js`：只读 allowTools、无 fullSurface、只用该线的 server、已装成功），无计费、无跨域。
- **萬星站内**：`ChatView` 与 `EmbedView` 是两份并行实现在 `wanxing-web/src/views/`（同构不同名的 `histKey`/`ctxKey`/`ownKey`、重复的 `loadHist/saveHist/ctxFor`、各自一份文本走树），问询卡只在 embed 侧渲染。
- **安全约束**：匿名采纳是**双门**（平台开关 + 部署者 per-agent 开关），且匿名永不落主人池（`wanxing-facade` 的 "Anonymous chat is double-gated and separately bounded"）。匿名动的是平台的钱。
- **契约约束**：萬星对兄弟线只走显式 HTTP 契约、env 可重指（`wanxing-borrowed-contracts`）。往 packs 部署台账写字段属于越界。

## Goals / Non-Goals

**Goals**
- 一条线接入对外副驾 = 一个 `<script>` 标签 + 0～3 个可选钩子，且接入方不写通信协议。
- 「这条线对外用哪个 agent」成为可在控制台看见、可撤销、立即生效的治理记录，而不是源码常量。
- 站内对话页与嵌入页共用一份对话核，问询卡与意图不再按容器分叉。
- 无法服务时**不渲染**，而不是渲染一张"请登录"的死卡。

**Non-Goals**
- 不统一两条副驾的助手来源（见决策 D4）。
- 不引入新的计费或配额概念；不改 A2A / 身份阶梯 / ask 协议。
- 不做 loader 的构建产物、CDN 或多版本并存机制（v1 只做一个版本 + 短缓存）。

## Decisions

### D1 绑定存萬星平面自己的库，不进 packs 台账、不进 pack manifest

新表 `wanxing_line_copilots(line PRIMARY KEY, agent_slug, accent, anonymous_intent, updated_by, updated_at)`，与既有 `wanxing_embed_settings`、`wanxing_host_allowance` 同库（`store.js` 的 SQLite）。

**为什么**
- 部署台账是兄弟线的资产，借用契约只读；写一个 `copilotLine` 进去等于让萬星反向拥有 packs 的 schema。
- pack manifest 加 `line` 要过发布门、市场版本通道、双语文案对齐（`i18n.tags` 同长约束），成本和风险都远高于收益；而且「同一条线的副驾」是平台治理决定，不是包的属性——一个包可能被两条线绑定。

**备选**
- 写进 `/api/packs/internal/deployments/:packId/:agentId/config`（`console.js:270` 已在代理该端点）：否决，越界写兄弟线。
- 加到 `category`：否决，语义是策展分类，已有 `fleet`/`wire` 等值，混用会污染市场筛选。

### D2 loader 就是宿主面：协议搬进 loader，宿主只剩声明

`wanxing-web/public/copilot.js`（静态文件，nginx `location /` 直接出）承担原识律那 124 行的全部职责：握手、`wx-copilot-context` 推送、`wx-copilot-identity-request` 应答、`wx-copilot-intent` 分派、iframe 注入与透明背景、收集 `open` 状态。

宿主只声明三件可选物：

```js
window.WanxingCopilot = window.WanxingCopilot || {};
WanxingCopilot.identify = () => ({ token });        // 每回合调用，可返回 null
WanxingCopilot.context  = () => ({ page, entity }); // 路由变化时调用
WanxingCopilot.intents  = { navigate: (arg) => router.push(arg) };  // 未声明的动词不执行
```

**为什么**：协议的每一处错误都只修一次；识律的 `navigate` 白名单（只认 `CONSOLE_TABS` 五路由、拒 `/admin` 与查询串）从"每个宿主自己写"变成"hook 自己实现"，白名单仍归宿主，正确性不降。

**备选**：发 npm 包 / React 组件——否决，五线技术栈不同（Astro 静态站、React 控制台、纯 HTML 营销页），一个 `<script>` 是唯一共同面。

### D3 绑定是「意图」，生效仍是既有的双门；差距必须可见

`anonymous_intent` 只表达"这条线希望允许匿名"。实际放行仍由平台匿名开关 AND 该 agent 的部署者开关决定（spec 未改）。控制台把 `intent` 与 `effective` 并排显示，不一致时给显式 gap 标记。

**为什么**：匿名花的是平台的钱，绕开部署者同意会破坏既有的安全不变量；而"默认是死的"真正的病根是**没人看得见它为什么是死的**。把静默陷阱改成可见缺口即可，不必改闸。

**备选**：绑定时自动打开该 agent 的匿名开关——否决，等于代部署者行使同意权，且这条同意是双门设计里唯一的部署者保护。

### D4 A/B 两条副驾的助手来源保持分叉（有意为之）

- 站内（`CopilotDock`）：按形状解析已装 pack，回答「这个 cell 里装了什么」。
- 对外（萬星）：按显式绑定，回答「这条线对外用哪一个」。

**为什么**：公开面若依赖某个 cell 的安装状态，则任一 cell 的装包/卸包会悄悄改变公共站点的助手；反之，治理决定也不该被安装顺序推翻（现有解析在多候选时取"最近安装"并打 warn，`copilot-presets.js`）。

**代价**：同一条线的站内副驾与外站副驾可能不是同一个 agent。这是可解释的分工，不是待修的 bug；写入本仓决策，防止后续"顺手统一"。

### D5 对话核抽取的边界

抽到 `wanxing-web/src/chat-core.js`（或同层模块），**入核**：历史读写与迁移、上下文 id、自带键桥、文本走树、SSE 帧分发、ask 渲染状态机与 answer 提交、截止倒计时。**留壳**：身份获取（chat = 登录态；embed = 三级阶梯）、外壳布局与主题、是否显示额度条。

**为什么**：两份实现的真正分叉在身份与外壳，其余逐字同构。抽核后 `#/chat` 自动获得问询卡，这正是"两条路径说两种话"里最刺眼的一条。

**存储迁移**：读时先看新键，未命中再读旧键（`wx-chat-*` / `wx-embed-*`），命中后写回新键并保留旧键一个版本周期；不做破坏性删除，避免"升级后历史消失"这类不可逆故障。

### D6 不能服务时选择「不注入」

loader 收到 `unbound` / `unknown` / `paused` / `closed` 一律不插 iframe，只 `console.warn` 一次原因（带 line 与 state）。`ready` 但 `anonymous` 非 open 且宿主没给 `identify` 时仍注入——那时登录墙是唯一诚实的出路，且文案必须点名登录到哪个平台（spec 已要求）。

**为什么**：静默死卡比没有入口更糟——它消耗访客一次点击并给出错误的心智模型；而"配置缺失"是运营问题，该在控制台看见，不该由访客承担。

### D7 公开解析端点的跨域与缓存

`GET /api/wanxing/v1/lines/:line/copilot` 设 `Access-Control-Allow-Origin: *`（facade 目前**没有任何 CORS**，这是首个跨域读端点），响应带 `Cache-Control: public, max-age=60`。`copilot.js` 走短缓存（`max-age=300`）且不发版号路径：v1 只此一版。

**为什么**：`*` 安全，因为投影只含公开信息（目录本就把 slug/name/description 公开）；60s 缓存让"解绑/暂停"最多滞后一分钟，与 loader 每次加载都解析的行为配合足够。

**备选**：绑定变更主动推送（SSE/WebSocket）——否决，为一次配置变更维持长连接不划算。

## Risks / Trade-offs

- [识律是在产唯一消费者，改造中断会拖垮其控制台副驾] → loader 先与旧片段并存上线；鉴律切到 loader 并走查通过后才删 124 行；两步分两次出片。
- [宿主把 loader 放进 `<head>` 同步加载会拖慢首屏] → loader 自身极小且 async 注入 iframe；文档默认给 `defer`/`async` 写法。
- [公开端点被当作目录全量接口刷] → 只按 line 单条解析，不提供列举；仍走既有边缘限流；响应无 quota/结算字段。
- [抽核时把身份逻辑误抽进 core，导致 embed 的匿名档泄漏到 chat] → core 只接受"已解析的 bearer + tier"入参，不 import 任何 auth 模块；这条作为评审要点写进 tasks。
- [`access-control-allow-origin: *` 与未来若加凭据类读端点混用会踩 CORS 规则] → 该端点永不接受凭据，响应头不加 `Allow-Credentials`；在代码注释里钉死。
- [历史迁移写坏导致老访客记录丢失] → 只读旧键、写新键、不删旧键；发布前用两条真实旧键样本做一次手工核对。

## Migration Plan

1. facade 出片：新表 + 公开端点 + console 读写端点（此时无绑定 = 全部 `unbound`）。
2. console 绑定识律现有 deployment（与其 `WIDGET_SLUG` 指向的 slug 一致），核对 `state=ready`。
3. `copilot.js` + 文档 + `host-demo.html` 出片定稿；识律保持旧片段不动。
4. 识律切到 loader（一行 + `identify` 钩子），并行观察一版；确认无回归后删除旧片段与 `WIDGET_SLUG`。
5. 抽核 + `#/chat` 接问询卡，最后一步（影响面最大、与接入无关）。

**回滚**：1-3 步各自可独立回退（表新增不动老路径；loader 不被引用即无效）。第 4 步回滚 = 恢复旧片段（保留在分支上直到观察期结束）。第 5 步回滚 = 还原两个 view 文件（core 本身无副作用）。

## Open Questions

- 线 id 的词表从哪来（`lex/wire/facet/base/constellation/marketing` 现散落在 `LINES-MCP-CONFORMANCE.md` 与 `appCatalog.ts`）：v1 由绑定写入时自由填写并做 slug 校验即可，是否需要一份单一词表留待后续 change。
- 多副驾（一条线按版面给不同 agent）当前非目标；绑定表主键即 line，扩展位留给未来加 `surface` 列。
